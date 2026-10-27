import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: "alice" }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: session.user }) }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => { throw new Error("Redirected to login."); },
}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-session",
  openSession: (user: string) => ({ dokployCookie: `test-session=${user}` }),
}));
vi.mock("./docker", () => ({
  deriveComposeRuntime: vi.fn(),
  deriveSwarmRuntime: vi.fn(),
  listRuntimeStates: vi.fn(),
}));

import { listMounts, type MountServiceType } from "./dokploy";

const fetchMock = vi.fn<typeof fetch>();

function tree(applicationIds = ["app-1"]) {
  return [{
    projectId: "project-1",
    name: "Workspace",
    environments: [{
      environmentId: "environment-1",
      name: "Production",
      applications: applicationIds.map((applicationId) => ({ applicationId })),
      compose: [{ composeId: "compose-1" }],
      postgres: [{ postgresId: "postgres-1" }],
      mysql: [],
      mariadb: [],
      mongo: [],
      redis: [],
    }],
  }];
}

function requestedPaths() {
  return fetchMock.mock.calls.map(([input]) => {
    const url = new URL(String(input));
    return `${url.pathname}${url.search}`;
  });
}

beforeEach(() => {
  session.user = "alice";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listMounts", () => {
  it("checks the workspace tree before reading application.one and maps all mount types", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tree()))
      .mockResolvedValueOnce(Response.json({
        mounts: [
          { mountId: "volume-1", type: "volume", mountPath: "/data", volumeName: "app-data", hostPath: null, filePath: null, content: null },
          { mountId: "bind-1", type: "bind", mountPath: "/cache", hostPath: "/srv/cache", volumeName: null },
          { mountId: "file-1", type: "file", mountPath: "/etc/app.conf", filePath: "app.conf", content: "enabled=true\n" },
          { mountId: "empty-file", type: "file", mountPath: "/etc/empty", filePath: "empty", content: "" },
        ],
      }));

    await expect(listMounts("application", "app-1")).resolves.toEqual([
      { mountId: "volume-1", type: "volume", mountPath: "/data", volumeName: "app-data", hostPath: null, filePath: null, content: null },
      { mountId: "bind-1", type: "bind", mountPath: "/cache", volumeName: null, hostPath: "/srv/cache", filePath: null, content: null },
      { mountId: "file-1", type: "file", mountPath: "/etc/app.conf", volumeName: null, hostPath: null, filePath: "app.conf", content: "enabled=true\n" },
      { mountId: "empty-file", type: "file", mountPath: "/etc/empty", volumeName: null, hostPath: null, filePath: "empty", content: "" },
    ]);
    expect(requestedPaths()).toEqual([
      "/api/project.all",
      "/api/application.one?applicationId=app-1",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("Cookie")).toBe("test-session=alice");
      expect(init?.cache).toBe("no-store");
    }
  });

  it.each(["unrelated-app", "compose-1", "postgres-1"])("rejects application ID %s outside the workspace application list", async (applicationId) => {
    fetchMock.mockResolvedValueOnce(Response.json(tree()));

    await expect(listMounts("application", applicationId)).rejects.toThrow("Unknown service.");
    expect(requestedPaths()).toEqual(["/api/project.all"]);
  });

  it.each(["unknown", "application&serviceId=app-1", ""])("rejects unsupported service type %j without API requests", async (serviceType) => {
    await expect(listMounts(serviceType as MountServiceType, "app-1")).rejects.toThrow("Unknown service.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty service ID without API requests", async () => {
    await expect(listMounts("application", "")).rejects.toThrow("Unknown service.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not read application details when the workspace lookup fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));

    await expect(listMounts("application", "app-1")).rejects.toThrow();
    expect(requestedPaths()).toEqual(["/api/project.all"]);
  });

  it("returns no mounts when application.one omits the relation", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tree()))
      .mockResolvedValueOnce(Response.json({}));

    await expect(listMounts("application", "app-1")).resolves.toEqual([]);
  });

  it("maps omitted and nullable mount fields to safe defaults", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tree()))
      .mockResolvedValueOnce(Response.json({ mounts: [{ mountId: "mount-1", mountPath: null }] }));

    await expect(listMounts("application", "app-1")).resolves.toEqual([{
      mountId: "mount-1", type: "volume", mountPath: "", volumeName: null,
      hostPath: null, filePath: null, content: null,
    }]);
  });

  it("checks membership again for a different user without sharing authorization", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tree()))
      .mockResolvedValueOnce(Response.json({ mounts: [] }))
      .mockResolvedValueOnce(Response.json(tree(["bobs-app"])));

    await expect(listMounts("application", "app-1")).resolves.toEqual([]);
    session.user = "bob";
    await expect(listMounts("application", "app-1")).rejects.toThrow("Unknown service.");

    expect(requestedPaths()).toEqual([
      "/api/project.all",
      "/api/application.one?applicationId=app-1",
      "/api/project.all",
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("Cookie")))
      .toEqual(["test-session=alice", "test-session=alice", "test-session=bob"]);
  });

  it("keeps the mounts endpoint for a workspace database", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tree()))
      .mockResolvedValueOnce(Response.json([{ mountId: "db-data", type: "volume", mountPath: "/data", volumeName: "db-data" }]));

    await expect(listMounts("postgres", "postgres-1")).resolves.toEqual([{
      mountId: "db-data", type: "volume", mountPath: "/data", volumeName: "db-data",
      hostPath: null, filePath: null, content: null,
    }]);
    expect(requestedPaths()).toEqual([
      "/api/project.all",
      "/api/mounts.listByServiceId?serviceType=postgres&serviceId=postgres-1",
    ]);
  });
});
