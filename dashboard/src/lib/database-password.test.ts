import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDatabasePasswordAction } from "../app/actions";
import { ENGINES, loadWorkspace, type Engine } from "./dokploy";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  openSession: vi.fn(),
  redirect: new Error("NEXT_REDIRECT"),
}));

vi.mock("server-only", () => ({}));
vi.mock("./docker", () => ({}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-session",
  openSession: mocks.openSession,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "sealed-test-session" }) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: () => { throw mocks.redirect; },
  unstable_rethrow: (error: unknown) => {
    if (error === mocks.redirect) throw error;
  },
}));

const genericFailure = { ok: false, error: "Could not load database password." };

function projectsWith(engine: Engine, id: string) {
  return [{
    projectId: "owned-project",
    name: "Owned project",
    environments: [{
      environmentId: "owned-environment",
      name: "production",
      postgres: [],
      mysql: [],
      mariadb: [],
      mongo: [],
      redis: [],
      applications: [],
      compose: [],
      [engine]: [{ [`${engine}Id`]: id }],
    }],
  }];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openSession.mockReturnValue({ dokployCookie: "test-user-session" });
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("database passwords", () => {
  it.each(ENGINES)("excludes %s passwords from workspace data", async (engine) => {
    const password = "private-database-password-sentinel";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith(engine, "owned-id")))
      .mockResolvedValueOnce(Response.json({ databasePassword: password }));

    const workspace = await loadWorkspace();
    expect(workspace.services).toHaveLength(1);
    expect(workspace.services[0]).toMatchObject({ kind: "database", databasePassword: null });
    expect(JSON.stringify(workspace)).not.toContain(password);
  });

  it.each(ENGINES)("checks ownership before loading a %s password", async (engine) => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith(engine, "owned-id")));

    expect(await loadDatabasePasswordAction(engine, "other-account-id")).toEqual(genericFailure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toMatch(/\/api\/project\.all$/);
  });

  it.each(ENGINES)("loads an owned %s password with the user's session", async (engine) => {
    const id = "owned/id?value=1";
    const password = "private-database-password-sentinel";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith(engine, id)))
      .mockResolvedValueOnce(Response.json({ databasePassword: password, env: "SECRET=other-value" }));

    expect(await loadDatabasePasswordAction(engine, id)).toEqual({ ok: true, password });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][0]).toContain(
      `/api/${engine}.one?${engine}Id=${encodeURIComponent(id)}`,
    );
    for (const [, options] of mocks.fetch.mock.calls) {
      expect(options.headers.Cookie).toBe("test-user-session");
    }
  });

  it("does not accept an ID owned under another engine", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith("redis", "shared-id")));

    expect(await loadDatabasePasswordAction("postgres", "shared-id")).toEqual(genericFailure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["application", "destination", ""])("rejects an invalid engine (%s)", async (engine) => {
    expect(await loadDatabasePasswordAction(engine as Engine, "id")).toEqual(genericFailure);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects an empty ID before fetching", async () => {
    expect(await loadDatabasePasswordAction("postgres", "")).toEqual(genericFailure);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ""])("returns an empty password (%s) without other detail", async (password) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("postgres", "owned-id")))
      .mockResolvedValueOnce(Response.json({ databasePassword: password, env: "SECRET=other-value" }));

    expect(await loadDatabasePasswordAction("postgres", "owned-id")).toEqual({ ok: true, password: "" });
  });

  it("rechecks ownership on every reveal or copy", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("postgres", "owned-id")))
      .mockResolvedValueOnce(Response.json({ databasePassword: "private-password" }))
      .mockResolvedValueOnce(Response.json([]));

    expect(await loadDatabasePasswordAction("postgres", "owned-id")).toEqual({ ok: true, password: "private-password" });
    expect(await loadDatabasePasswordAction("postgres", "owned-id")).toEqual(genericFailure);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not expose backend error details", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("postgres", "owned-id")))
      .mockResolvedValueOnce(new Response("private backend detail", { status: 500 }));

    expect(await loadDatabasePasswordAction("postgres", "owned-id")).toEqual(genericFailure);
  });

  it("preserves a login redirect for an invalid session", async () => {
    mocks.openSession.mockReturnValue(null);

    await expect(loadDatabasePasswordAction("postgres", "id")).rejects.toBe(mocks.redirect);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves a login redirect when Dokploy rejects the session", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(loadDatabasePasswordAction("postgres", "id")).rejects.toBe(mocks.redirect);
  });
});
