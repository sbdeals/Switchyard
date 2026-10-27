import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  openSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-session" }) }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => { throw new Error("NEXT_REDIRECT"); },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-session",
  openSession: mocks.openSession,
}));
vi.mock("./docker", () => ({
  listRuntimeStates: async () => { throw new Error("No test Docker socket"); },
}));

import { getDatabaseConnectionAction } from "../app/db-connect-actions";
import { ENGINES, loadWorkspace, type Engine } from "./dokploy";

function tree(engine: Engine = "postgres", id = "owned-db") {
  return [{
    projectId: "project-1",
    name: "Test project",
    environments: [{
      environmentId: "environment-1",
      name: "Test environment",
      applications: [],
      compose: [],
      ...Object.fromEntries(ENGINES.map((item) => [item, []])),
      [engine]: [{ [`${engine}Id`]: id }],
    }],
  }];
}

function serveDatabase(detail: Record<string, unknown>, projects = tree()) {
  mocks.fetch.mockImplementation(async (input: string) => {
    const path = new URL(input).pathname;
    if (path === "/api/project.all") return Response.json(projects);
    if (path.endsWith(".one")) return Response.json(detail);
    throw new Error("Unexpected test request");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openSession.mockReturnValue({ dokployCookie: "test-user-cookie" });
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("SWITCHYARD_HOST_IP", "");
  vi.stubEnv("DOKPLOY_ORIGIN", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("database credential access", () => {
  it.each(ENGINES)("reads an owned %s password through the current user's session", async (engine) => {
    serveDatabase({ databasePassword: "test-@:/?#%" }, tree(engine));

    expect(await getDatabaseConnectionAction(engine, "owned-db")).toEqual({
      ok: true,
      password: "test-@:/?#%",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][0]).toContain("/api/project.all");
    expect(mocks.fetch.mock.calls[1][0]).toContain(`/api/${engine}.one?${engine}Id=owned-db`);
    for (const [, init] of mocks.fetch.mock.calls) {
      expect(init.headers.Cookie).toBe("test-user-cookie");
      expect(init.cache).toBe("no-store");
    }
  });

  it("does not load details for an ID outside the user's project tree", async () => {
    serveDatabase({ databasePassword: "must-not-read" });

    expect(await getDatabaseConnectionAction("postgres", "other-user-db")).toEqual({
      ok: false,
      error: "Could not load database credentials. Please try again.",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("requires ownership for the requested engine, even when another engine has the ID", async () => {
    serveDatabase({ databasePassword: "must-not-read" }, tree("redis"));

    expect((await getDatabaseConnectionAction("postgres", "owned-db")).ok).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unknown engine", "other", "owned-db"],
    ["object engine", {}, "owned-db"],
    ["empty ID", "postgres", ""],
    ["blank ID", "postgres", "   "],
    ["non-string ID", "postgres", null],
    ["oversized ID", "postgres", "a".repeat(257)],
  ])("rejects %s before requesting credentials", async (_, engine, id) => {
    expect((await getDatabaseConnectionAction(engine as Engine, id as string)).ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not cache ownership between requests", async () => {
    serveDatabase({ databasePassword: "test-password" });
    expect((await getDatabaseConnectionAction("postgres", "owned-db")).ok).toBe(true);

    serveDatabase({ databasePassword: "must-not-read" }, []);
    expect((await getDatabaseConnectionAction("postgres", "owned-db")).ok).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not leak backend error details", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(tree()))
      .mockResolvedValueOnce(new Response("backend includes test-secret", { status: 500 }));

    expect(await getDatabaseConnectionAction("postgres", "owned-db")).toEqual({
      ok: false,
      error: "Could not load database credentials. Please try again.",
    });
  });

  it("returns a generic error when no password is available", async () => {
    serveDatabase({ databasePassword: null });
    expect(await getDatabaseConnectionAction("postgres", "owned-db")).toEqual({
      ok: false,
      error: "Could not load database credentials. Please try again.",
    });
  });

  it("preserves login redirects without requesting details for an anonymous caller", async () => {
    mocks.openSession.mockReturnValue(null);
    await expect(getDatabaseConnectionAction("postgres", "owned-db")).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("database workspace data", () => {
  it.each(ENGINES)("does not serialize the %s password before reveal", async (engine) => {
    serveDatabase({
      appName: "test-database",
      databaseName: "test-db",
      databaseUser: "test-user",
      databasePassword: "initial-payload-must-not-contain-this",
    }, tree(engine));

    const workspace = await loadWorkspace();
    expect(workspace.services[0]).toMatchObject({
      engine,
      appName: "test-database",
      databasePassword: null,
    });
    expect(JSON.stringify(workspace)).not.toContain("initial-payload-must-not-contain-this");
  });

  it("uses the explicit local host IP for external connections", async () => {
    vi.stubEnv("SWITCHYARD_HOST_IP", "192.0.2.10");
    vi.stubEnv("DOKPLOY_ORIGIN", "https://dashboard.example.test");
    serveDatabase({ externalPort: 15432 });
    expect((await loadWorkspace()).services[0]).toMatchObject({ externalHost: "192.0.2.10" });
  });

  it("uses the public Dokploy origin when no host IP is configured", async () => {
    vi.stubEnv("DOKPLOY_ORIGIN", "https://dokploy.example.test:3000");
    serveDatabase({ externalPort: 15432 });
    expect((await loadWorkspace()).services[0]).toMatchObject({ externalHost: "dokploy.example.test" });
  });

  it("uses the remote server address instead of the dashboard host", async () => {
    vi.stubEnv("SWITCHYARD_HOST_IP", "192.0.2.10");
    serveDatabase({ serverId: "remote-server", server: { ipAddress: "192.0.2.20" } });
    expect((await loadWorkspace()).services[0]).toMatchObject({ externalHost: "192.0.2.20" });
  });

  it("leaves an unknown remote address unset instead of using the dashboard host", async () => {
    vi.stubEnv("SWITCHYARD_HOST_IP", "192.0.2.10");
    serveDatabase({ serverId: "remote-server" });
    expect((await loadWorkspace()).services[0]).toMatchObject({ externalHost: null });
  });

  it.each(["", "invalid-origin"])("does not use private service DNS when the public origin is %j", async (origin) => {
    vi.stubEnv("DOKPLOY_ORIGIN", origin);
    serveDatabase({});
    expect((await loadWorkspace()).services[0]).toMatchObject({ externalHost: null });
  });
});
