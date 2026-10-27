import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  listMounts: vi.fn(),
  controlFlow: new Error("NEXT_REDIRECT"),
}));

vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({ request: mocks.request, listMounts: mocks.listMounts }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error === mocks.controlFlow) throw error;
  },
}));

import { exportEnvironment } from "./compose-export-data";
import { loadComposeExportAction } from "../app/compose-export-actions";

const tree = [{ environments: [{ applications: [{ applicationId: "app-1" }] }] }];
const application = {
  name: "My application",
  appName: "my-application",
  sourceType: "docker",
  dockerImage: "nginx:alpine",
  env: "TOKEN=private-env-value\nEMPTY=\nMESSAGE='first\nFAKE_KEY=still-secret\nlast'",
  registryPassword: "private-registry-value",
  refreshToken: "private-webhook-value",
  ports: [{ portId: "port-1", publishedPort: 8080, targetPort: 80, protocol: "tcp", publishMode: "host" }],
  cpuLimit: "0.5",
  memoryLimit: "256m",
  restartPolicySwarm: { Condition: "on-failure", MaxAttempts: 3, extra: "private-extra-value" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "project.all") return tree;
    if (path === "application.one?applicationId=app-1") return application;
    throw new Error(`Unexpected request ${path}`);
  });
  mocks.listMounts.mockResolvedValue([{
    mountId: "mount-1",
    type: "file",
    mountPath: "/etc/app.conf",
    filePath: "app.conf",
    hostPath: null,
    volumeName: null,
    content: "private-file-value",
  }]);
});

describe("compose export access", () => {
  it("checks project ownership before reading details or mounts", async () => {
    const result = await loadComposeExportAction("app-1");
    expect(result.ok).toBe(true);
    expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
      "project.all", "application.one?applicationId=app-1",
    ]);
    expect(mocks.listMounts).toHaveBeenCalledWith("application", "app-1");
    expect(mocks.request.mock.invocationCallOrder[1]).toBeLessThan(mocks.listMounts.mock.invocationCallOrder[0]);
  });

  it.each([false, true])("denies foreign applications before reading private data (includeValues=%s)", async (includeValues) => {
    expect(await loadComposeExportAction("foreign-app", includeValues)).toEqual({
      ok: false, error: "Could not export this application. Please try again.",
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.listMounts).not.toHaveBeenCalled();
  });

  it("denies applications outside the current user's environments", async () => {
    mocks.request.mockResolvedValueOnce([{ environments: [{ applications: [] }] }, {}]);
    expect((await loadComposeExportAction("app-1")).ok).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.listMounts).not.toHaveBeenCalled();
  });

  it("returns only environment names by default, without file contents or unrelated secrets", async () => {
    const result = await loadComposeExportAction("app-1");
    if (!result.ok) throw new Error(result.error);
    expect(result.data.environment).toEqual([{ key: "TOKEN" }, { key: "EMPTY" }, { key: "MESSAGE" }]);
    expect(result.data.mounts).toEqual([{
      type: "file", mountPath: "/etc/app.conf", filePath: "app.conf", hostPath: null, volumeName: null,
    }]);
    expect(JSON.stringify(result)).not.toMatch(/private-|still-secret|FAKE_KEY|content|refreshToken|registryPassword/);
    expect(result.data.ports).toEqual([{
      publishedPort: 8080, targetPort: 80, protocol: "tcp", publishMode: "host",
    }]);
    expect(result.data.cpuLimit).toBe("0.5");
    expect(result.data.memoryLimit).toBe("256m");
    expect(result.data.restartPolicySwarm?.MaxAttempts).toBe(3);
  });

  it("includes environment values only with an explicit true option", async () => {
    const result = await loadComposeExportAction("app-1", true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.environment).toEqual([
      { key: "TOKEN", value: "private-env-value" },
      { key: "EMPTY", value: "" },
      { key: "MESSAGE", value: "first\nFAKE_KEY=still-secret\nlast" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private-file|private-registry|private-webhook|private-extra/);
    const masked = await loadComposeExportAction("app-1", false);
    expect(JSON.stringify(masked)).not.toContain("private-env-value");
  });

  it("rejects nonboolean opt-ins and invalid ids without backend reads", async () => {
    expect((await loadComposeExportAction("app-1", "true" as unknown as boolean)).ok).toBe(false);
    expect((await loadComposeExportAction("")).ok).toBe(false);
    expect((await loadComposeExportAction(null as unknown as string)).ok).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("uses generic errors when backend reads contain sensitive details", async () => {
    mocks.listMounts.mockRejectedValueOnce(new Error("private-backend-message"));
    expect(await loadComposeExportAction("app-1")).toEqual({
      ok: false, error: "Could not export this application. Please try again.",
    });
  });

  it("preserves Next.js control-flow errors", async () => {
    mocks.request.mockRejectedValueOnce(mocks.controlFlow);
    await expect(loadComposeExportAction("app-1")).rejects.toBe(mocks.controlFlow);
  });

  it("returns empty defaults for unset optional configuration", async () => {
    mocks.request.mockResolvedValueOnce(tree).mockResolvedValueOnce({ name: "Git app", sourceType: "git" });
    mocks.listMounts.mockResolvedValueOnce([]);
    const result = await loadComposeExportAction("app-1");
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toEqual({
      name: "Git app", sourceType: "git", dockerImage: null, environment: [], ports: [], mounts: [],
      cpuLimit: null, memoryLimit: null, restartPolicySwarm: null,
    });
  });
});

describe("environment parsing", () => {
  it("handles dotenv quoting, comments, empty values, and duplicate keys", () => {
    const env = [
      "# ignored", "export TOKEN = old", "TOKEN=new# comment", "EMPTY=", "NEXT=next",
      "QUOTED=\"# colon: 'literal'\" # comment", "MULTILINE='first", "second'",
      'ESCAPED="first\\nsecond\\rthird"', "BACKTICK=`a # b`", "app.key=punctuation",
    ].join("\r\n");
    expect(exportEnvironment(env, true)).toEqual([
      { key: "TOKEN", value: "new" }, { key: "EMPTY", value: "" }, { key: "NEXT", value: "next" },
      { key: "QUOTED", value: "# colon: 'literal'" }, { key: "MULTILINE", value: "first\nsecond" },
      { key: "ESCAPED", value: "first\nsecond\rthird" }, { key: "BACKTICK", value: "a # b" },
      { key: "app.key", value: "punctuation" },
    ]);
  });

  it("does not parse variable-like text inside multiline secrets as environment names", () => {
    expect(exportEnvironment('CERT="start\nSECRET_BODY=value\nend"\nREAL=yes', false)).toEqual([
      { key: "CERT" }, { key: "REAL" },
    ]);
  });
});
