import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDatabasePasswordAction } from "../app/actions";
import { DatabaseCredentials } from "../components/service/DatabaseCredentials";
import { ENGINES, type Database, type Engine } from "./dokploy";

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

const genericFailure = { ok: false, error: "Could not load database credentials." };

function projectsWith(engine: Engine, id: string) {
  return [{
    projectId: "owned-project",
    name: "Owned project",
    environments: [{
      environmentId: "owned-environment",
      name: "production",
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

describe("loadDatabasePasswordAction", () => {
  it.each(ENGINES)("does not fetch an unowned %s password", async (engine) => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith(engine, "owned-id")));

    expect(await loadDatabasePasswordAction(engine, "other-id")).toEqual(genericFailure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toMatch(/\/api\/project\.all$/);
    expect(mocks.fetch.mock.calls[0][1].headers.Cookie).toBe("test-user-session");
  });

  it.each(ENGINES)("returns only the owned %s password", async (engine) => {
    const id = "owned/id?value=1";
    const password = "database-password-action-sentinel";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith(engine, id)))
      .mockResolvedValueOnce(Response.json({ databasePassword: password, env: "TOKEN=must-stay-server-side" }));

    expect(await loadDatabasePasswordAction(engine, id)).toEqual({ ok: true, password });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][0]).toContain(
      `/api/${engine}.one?${engine}Id=${encodeURIComponent(id)}`,
    );
    expect(mocks.fetch.mock.calls[1][1].headers.Cookie).toBe("test-user-session");
  });

  it("does not accept an ID owned under another engine", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith("redis", "shared-id")));

    expect(await loadDatabasePasswordAction("postgres", "shared-id")).toEqual(genericFailure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects non-database service types and empty IDs before requesting", async () => {
    expect(await loadDatabasePasswordAction("application" as Engine, "id")).toEqual(genericFailure);
    expect(await loadDatabasePasswordAction("postgres", "")).toEqual(genericFailure);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ""])("supports an absent password (%s)", async (password) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("redis", "owned-id")))
      .mockResolvedValueOnce(Response.json({ databasePassword: password }));

    expect(await loadDatabasePasswordAction("redis", "owned-id"))
      .toEqual({ ok: true, password: password ?? null });
  });

  it("does not expose backend error details", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("private credential detail", { status: 500 }));

    expect(await loadDatabasePasswordAction("postgres", "id")).toEqual(genericFailure);
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

describe("DatabaseCredentials", () => {
  const db: Database = {
    kind: "database",
    engine: "postgres",
    id: "database-id",
    name: "test-database",
    appName: "test-database-app",
    status: "idle",
    projectId: "project-id",
    projectName: "Test project",
    environmentId: "environment-id",
    environmentName: "production",
    dockerImage: "postgres:17",
    env: "TOKEN=env-prop-sentinel",
    createdAt: null,
    cpuLimit: null,
    memoryLimit: null,
    replicas: null,
    databaseName: "test",
    databaseUser: "admin",
    databasePassword: "password-prop-sentinel",
    externalPort: null,
    command: null,
  };

  it.each(["connection", "password"] as const)("keeps the %s view loading without using page secrets", (view) => {
    const html = renderToStaticMarkup(createElement(DatabaseCredentials, { db, view }));

    expect(html).toContain('aria-label="Loading database credentials"');
    expect(html).not.toContain("password-prop-sentinel");
    expect(html).not.toContain("env-prop-sentinel");
    expect(html).not.toContain("postgresql://");
    expect(html).not.toContain("<button");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
