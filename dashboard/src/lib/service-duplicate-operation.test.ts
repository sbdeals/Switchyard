import { describe, expect, it, vi } from "vitest";
import { duplicateService } from "./service-duplicate-operation";
import type { DuplicateServiceRef } from "./service-duplicate";

const ref: DuplicateServiceRef = { kind: "compose", id: "source" };
const source = {
  name: "web",
  env: "GREETING=hello",
  composeFile: "services:\n  web:\n    image: nginx:alpine\n    volumes: [data:/data]\nvolumes:\n  data:\n",
  sourceType: "raw",
};

function fixture() {
  const tree = [{ environments: [
    { environmentId: "current", compose: [{ composeId: "source", name: "web" }] },
    { environmentId: "target", applications: [{ applicationId: "other", name: "other" }] },
  ] }, { environments: [{ environmentId: "foreign" }] }];
  const api = vi.fn(async (path: string, init?: { method: "POST"; body: unknown }): Promise<unknown> => {
    void init;
    if (path === "project.all") return tree;
    if (path === "compose.one?composeId=source") return source;
    if (path.startsWith("mounts.listByServiceId")) return [];
    if (path === "compose.create") return { composeId: "copy" };
    return {};
  });
  return { api, tree };
}

describe("duplicateService", () => {
  it("checks ownership, copies into a sibling environment, and never deploys", async () => {
    const { api } = fixture();
    await expect(duplicateService(api, ref, "web-copy", "target", "unique")).resolves.toBe("copy");
    expect(api.mock.calls[0][0]).toBe("project.all");
    expect(api).toHaveBeenCalledWith("compose.create", {
      method: "POST", body: expect.objectContaining({ name: "web-copy", environmentId: "target" }),
    });
    expect(api).toHaveBeenCalledWith("compose.saveEnvironment", {
      method: "POST", body: expect.objectContaining({ composeId: "copy", env: "GREETING=hello" }),
    });
    expect(api.mock.calls.some(([path]) => /\.(deploy|start|reload)|domain\./.test(path))).toBe(false);
  });

  it.each(["foreign", "missing"])("rejects target %s before reading source configuration", async (target) => {
    const { api } = fixture();
    await expect(duplicateService(api, ref, "web-copy", target, "unique")).rejects.toThrow("Source and target");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("reads repository compose files through Dokploy before making an isolated snapshot", async () => {
    const { api } = fixture();
    const implementation = api.getMockImplementation()!;
    api.mockImplementation(async (path, init) => {
      if (path === "compose.one?composeId=source") return { ...source, sourceType: "git", composeFile: "" };
      if (path === "compose.getConvertedCompose?composeId=source") return source.composeFile;
      return implementation(path, init);
    });
    await duplicateService(api, ref, "web-copy", "target", "unique");
    expect(api).toHaveBeenCalledWith("compose.getConvertedCompose?composeId=source");
    expect(api).toHaveBeenCalledWith("compose.update", {
      method: "POST", body: expect.objectContaining({ composeId: "copy", sourceType: "raw", autoDeploy: false }),
    });
    expect(api.mock.calls.some(([path]) => /\.(deploy|fetchSourceType)/.test(path))).toBe(false);
  });

  it("rejects a source absent from the user's project tree", async () => {
    const { api } = fixture();
    await expect(duplicateService(api, { ...ref, id: "hidden" }, "web-copy", "target", "unique"))
      .rejects.toThrow("Source and target");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("does not trust malformed service references or invalid names", async () => {
    const { api } = fixture();
    await expect(duplicateService(api, { kind: "postgres", id: "source" } as unknown as DuplicateServiceRef, "copy", "target", "unique"))
      .rejects.toThrow("Invalid service");
    await expect(duplicateService(api, ref, "bad/name", "target", "unique")).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });

  it("rejects collisions across service kinds before creating anything", async () => {
    const { api } = fixture();
    await expect(duplicateService(api, ref, "other", "target", "unique")).rejects.toThrow();
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("resolves names when project.all returns only database IDs", async () => {
    const { api, tree } = fixture();
    Object.assign(tree[0].environments[1], { postgres: [{ postgresId: "db" }] });
    const implementation = api.getMockImplementation()!;
    api.mockImplementation(async (path, init) => path === "postgres.one?postgresId=db"
      ? { name: "web-copy" } : implementation(path, init));
    await expect(duplicateService(api, ref, "web-copy", "target", "unique")).rejects.toThrow();
    expect(api).toHaveBeenCalledWith("postgres.one?postgresId=db");
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("removes only the newly created service if configuration fails", async () => {
    const { api } = fixture();
    const implementation = api.getMockImplementation()!;
    api.mockImplementation(async (path, init) => {
      if (path === "compose.saveEnvironment") throw new Error("Save failed");
      return implementation(path, init);
    });
    await expect(duplicateService(api, ref, "web-copy", "target", "unique")).rejects.toThrow("Save failed");
    expect(api).toHaveBeenLastCalledWith("compose.delete", { method: "POST", body: { composeId: "copy", deleteVolumes: false } });
  });

  it("reports the incomplete copy if cleanup also fails", async () => {
    const { api } = fixture();
    const implementation = api.getMockImplementation()!;
    api.mockImplementation(async (path, init) => {
      if (path === "compose.update" || path === "compose.delete") throw new Error("Unavailable");
      return implementation(path, init);
    });
    await expect(duplicateService(api, ref, "web-copy", "target", "unique"))
      .rejects.toThrow('Remove the incomplete service "web-copy" (copy)');
  });

  it.each(["postgres", "mysql", "mariadb", "mongo", "redis"] as const)("replaces %s's default mount with an empty named volume", async (engine) => {
    const { api, tree } = fixture();
    Object.assign(tree[0].environments[0], { [engine]: [{ [`${engine}Id`]: "db-source", name: "db" }] });
    const implementation = api.getMockImplementation()!;
    api.mockImplementation(async (path, init) => {
      if (path === `${engine}.one?${engine}Id=db-source`) return {
        name: "db", databaseName: "data", databaseUser: "user", databasePassword: "test-only", dockerImage: `${engine}:latest`,
      };
      if (path === `${engine}.create`) return { [`${engine}Id`]: "db-copy" };
      if (path.endsWith("serviceId=db-source")) return [{ type: "volume", volumeName: "original", mountPath: "/data" }];
      if (path.endsWith("serviceId=db-copy")) return [{ mountId: "default-copy-mount" }];
      return implementation(path, init);
    });
    await duplicateService(api, { kind: "database", id: "db-source", engine }, "db-copy", "target", "unique");
    const remove = api.mock.calls.findIndex(([path]) => path === "mounts.remove");
    const create = api.mock.calls.findIndex(([path]) => path === "mounts.create");
    expect(remove).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(remove);
    expect(api.mock.calls[remove][1]?.body).toEqual({ mountId: "default-copy-mount" });
    expect(api.mock.calls[create][1]?.body).toMatchObject({ type: "volume", mountPath: "/data", serviceId: "db-copy", serviceType: engine });
    expect(api.mock.calls[create][1]?.body).not.toMatchObject({ volumeName: "original" });
    expect(api.mock.calls.some(([path]) => /\.(deploy|reload|saveExternalPort)/.test(path))).toBe(false);
  });

  it("copies application ports with the new ID and uses application.delete on failure", async () => {
    const { api, tree } = fixture();
    Object.assign(tree[0].environments[0], { applications: [{ applicationId: "app", name: "app" }] });
    const implementation = api.getMockImplementation()!;
    api.mockImplementation(async (path, init) => {
      if (path === "application.one?applicationId=app") return {
        sourceType: "docker", dockerImage: "nginx:alpine",
        ports: [{ publishedPort: 8080, targetPort: 80, protocol: "tcp", publishMode: "ingress" }],
      };
      if (path === "application.create") return { applicationId: "app-copy" };
      if (path === "port.create") throw new Error("Port failed");
      return implementation(path, init);
    });
    await expect(duplicateService(api, { kind: "application", id: "app" }, "app-copy", "target", "unique"))
      .rejects.toThrow("Port failed");
    expect(api).toHaveBeenCalledWith("port.create", {
      method: "POST", body: { applicationId: "app-copy", publishedPort: 8080, targetPort: 80, protocol: "tcp", publishMode: "ingress" },
    });
    expect(api).toHaveBeenLastCalledWith("application.delete", { method: "POST", body: { applicationId: "app-copy" } });
  });
});
