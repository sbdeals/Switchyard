import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({ request: vi.fn() }));

import { request } from "./dokploy";
import {
  duplicateError,
  duplicateOptions,
  executeEnvironmentDuplicate,
  prepareEnvironmentDuplicate,
  type DuplicateEvent,
} from "./environment-duplicate-server";
import type { DuplicateOptions } from "./environment-duplicate";

const options: DuplicateOptions = { projectId: "project", sourceEnvironmentId: "source", name: "staging" };
const call = vi.mocked(request);
let sourceEnv: Record<string, unknown>;
let details: Record<string, Record<string, unknown>>;
let mounts: Record<string, Record<string, unknown>[]>;
let failPath: string | undefined;

beforeEach(() => {
  call.mockReset();
  failPath = undefined;
  sourceEnv = { environmentId: "source", name: "development", env: "SHARED=source-value", compose: [{ composeId: "api" }, { composeId: "worker" }] };
  details = {
    api: { name: "api", sourceType: "raw", composeFile: "services:\n  api:\n    image: nginx:alpine", env: "GREETING=hello" },
    worker: { name: "worker", sourceType: "raw", composeFile: "services:\n  worker:\n    image: alpine", env: "API_URL=http://api:80" },
  };
  mounts = {};
  call.mockImplementation(async (path, init) => {
    if (path === failPath) throw new Error("Dokploy response with SECRET=must-never-leak");
    if (path === "project.all") return [{ projectId: "project", name: "Proof", environments: [{ environmentId: "source", name: "development" }] }];
    if (path.startsWith("environment.one?")) return sourceEnv;
    if (path.includes(".one?")) return details[new URLSearchParams(path.split("?")[1]).values().next().value as string];
    if (path.startsWith("mounts.listByServiceId?")) return mounts[new URLSearchParams(path.split("?")[1]).get("serviceId")!] ?? [];
    if (path === "environment.create") return { environmentId: "target" };
    if (path.endsWith(".create") && path !== "port.create" && path !== "mounts.create") {
      const type = path.split(".")[0];
      const body = init?.body as Record<string, unknown>;
      return { [`${type}Id`]: `new-${body.name}` };
    }
    return null;
  });
});

async function execute(input = options) {
  const preflight = await prepareEnvironmentDuplicate(input);
  const events: DuplicateEvent[] = [];
  await executeEnvironmentDuplicate(input, preflight.fingerprint, (event) => events.push(event));
  return { preflight, events };
}

function mutations() {
  return call.mock.calls.filter(([, init]) => init?.method === "POST");
}

describe("environment duplicate orchestration", () => {
  it("reads through the user's project and returns a preflight without values", async () => {
    const { summary, fingerprint } = await prepareEnvironmentDuplicate(options);
    expect(summary.services).toHaveLength(2);
    expect(summary.options).toMatchObject({ copyVariables: true, deploy: false });
    expect(summary.environmentVariableCount).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("source-value");
    expect(JSON.stringify(summary)).not.toContain("GREETING=hello");
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(mutations()).toEqual([]);
  });

  it("copies both services and shared variables without deploying or deleting", async () => {
    const { events } = await execute();
    expect(call).toHaveBeenCalledWith("environment.update", { method: "POST", body: { environmentId: "target", env: "SHARED=source-value" } });
    expect(call).toHaveBeenCalledWith("compose.create", { method: "POST", body: { name: "api", environmentId: "target" } });
    expect(call).toHaveBeenCalledWith("compose.saveEnvironment", { method: "POST", body: { composeId: "new-worker", env: "API_URL=http://api:80" } });
    expect(events).toContainEqual({ type: "environment", environmentId: "target" });
    expect(events).toContainEqual({ type: "service", sourceId: "worker", status: "copied", id: "new-worker" });
    expect(events.at(-1)).toEqual({ type: "done", failed: 0, environmentId: "target" });
    expect(mutations().some(([path]) => /deploy|delete|remove/.test(path))).toBe(false);
  });

  it("omits shared and service variables when copy variables is off", async () => {
    await execute({ ...options, copyVariables: false });
    expect(mutations().some(([path]) => /saveEnvironment|environment.update/.test(path))).toBe(false);
  });

  it("rejects source changes since preflight before creating anything", async () => {
    const preflight = await prepareEnvironmentDuplicate(options);
    details.api.env = "GREETING=changed";
    await expect(executeEnvironmentDuplicate(options, preflight.fingerprint, vi.fn())).rejects.toThrow("changed after preflight");
    expect(mutations()).toEqual([]);
  });

  it("reports retained service IDs, continues after a partial failure and skips deploy", async () => {
    const preflight = await prepareEnvironmentDuplicate({ ...options, deploy: true });
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (path, init) => {
      if (path === "compose.update" && (init?.body as Record<string, unknown>).composeId === "new-api") throw new Error("SECRET=must-never-leak");
      return original(path, init);
    });
    const events: DuplicateEvent[] = [];
    await executeEnvironmentDuplicate({ ...options, deploy: true }, preflight.fingerprint, (event) => events.push(event));
    expect(events).toContainEqual(expect.objectContaining({ type: "service", sourceId: "api", status: "failed", id: "new-api" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "service", sourceId: "worker", status: "deploy-skipped", id: "new-worker" }));
    expect(events.at(-1)).toEqual({ type: "done", failed: 1, environmentId: "target" });
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(mutations().some(([path]) => /deploy|delete|remove/.test(path))).toBe(false);
  });

  it("queues deployments only after every service is configured and reports deploy failures", async () => {
    failPath = "compose.deploy";
    const { events } = await execute({ ...options, deploy: true });
    const paths = mutations().map(([path]) => path);
    expect(paths.indexOf("compose.deploy")).toBeGreaterThan(paths.lastIndexOf("compose.saveEnvironment"));
    expect(events.filter((event) => event.type === "service" && event.status === "deploy-failed")).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: "done", failed: 2, environmentId: "target" });
  });

  it("uses fresh volume names and reuses the database's default mount", async () => {
    sourceEnv.compose = [];
    sourceEnv.postgres = [{ postgresId: "db" }];
    details.db = { name: "db", dockerImage: "postgres:17", databaseName: "app", databaseUser: "app", databasePassword: "test-only" };
    mounts.db = [{ mountId: "source-mount", type: "volume", mountPath: "/var/lib/postgresql/data", volumeName: "source-data" }];
    mounts["new-db"] = [{ mountId: "target-mount", type: "volume", mountPath: "/var/lib/postgresql/data", volumeName: "target-default" }];
    await execute();
    expect(call).toHaveBeenCalledWith("mounts.update", { method: "POST", body: { mountId: "target-mount", type: "volume", mountPath: "/var/lib/postgresql/data", volumeName: "duplicate-target-0" } });
    expect(mutations().some(([path]) => path === "mounts.create")).toBe(false);
    expect(JSON.stringify(mutations())).not.toContain("source-data");
  });

  it("preserves sharing of a named volume within the copy using a fresh identity", async () => {
    mounts.api = [
      { type: "volume", mountPath: "/data", volumeName: "source-shared" },
      { type: "volume", mountPath: "/data-again", volumeName: "source-shared" },
    ];
    mounts.worker = [{ type: "volume", mountPath: "/data", volumeName: "source-shared" }];
    await execute();
    const bodies = mutations().filter(([path]) => path === "mounts.create").map(([, init]) => init!.body as Record<string, unknown>);
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies.map((body) => body.volumeName))).toEqual(new Set(["duplicate-target-0"]));
    expect(JSON.stringify(bodies)).not.toContain("source-shared");
    expect(bodies.every((body) => !("sourceVolumeName" in body))).toBe(true);
  });

  it("does not hide unsupported services or accept projects outside the user's tree", async () => {
    sourceEnv.libsql = [{ libsqlId: "unsupported" }];
    await expect(prepareEnvironmentDuplicate(options)).rejects.toThrow("libSQL");
    await expect(prepareEnvironmentDuplicate({ ...options, projectId: "other" })).rejects.toThrow("not found");
    expect(mutations()).toEqual([]);
  });

  it("leaves the new environment visible if shared variables cannot be copied", async () => {
    const { fingerprint } = await prepareEnvironmentDuplicate(options);
    failPath = "environment.update";
    const emit = vi.fn();
    await expect(executeEnvironmentDuplicate(options, fingerprint, emit)).rejects.toThrow("no services were created");
    expect(emit).toHaveBeenCalledWith({ type: "environment", environmentId: "target" });
    expect(mutations().some(([path]) => path === "compose.create")).toBe(false);
  });

  it("rejects malformed options and hides backend error bodies", () => {
    expect(() => duplicateOptions({ ...options, deploy: "true" })).toThrow("Invalid duplicate options");
    expect(duplicateError(new Error("SECRET=must-never-leak"))).not.toContain("SECRET");
  });
});
