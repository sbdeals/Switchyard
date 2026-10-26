import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDatabaseCredentialsAction } from "../app/database-credentials-actions";
import { ServiceDrawer } from "../components/service/ServiceDrawer";
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

afterEach(() => vi.unstubAllGlobals());

describe("loadDatabaseCredentialsAction", () => {
  it.each(ENGINES)("does not fetch %s credentials for another account", async (engine) => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith(engine, "owned-id")));

    expect(await loadDatabaseCredentialsAction(engine, "other-account-id")).toEqual(genericFailure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toMatch(/\/api\/project\.all$/);
    expect(mocks.fetch.mock.calls[0][1].headers.Cookie).toBe("test-user-session");
  });

  it.each(ENGINES)("loads only the owned %s password with the user's session", async (engine) => {
    const id = "owned/id?value=1";
    const password = "database-credentials-action-sentinel";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith(engine, id)))
      .mockResolvedValueOnce(Response.json({ databasePassword: password, env: "TOKEN=private-env" }));

    expect(await loadDatabaseCredentialsAction(engine, id)).toEqual({ ok: true, password });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][0]).toContain(
      `/api/${engine}.one?${engine}Id=${encodeURIComponent(id)}`,
    );
    expect(mocks.fetch.mock.calls[1][1].headers.Cookie).toBe("test-user-session");
  });

  it("rejects an ID owned under a different engine", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith("mysql", "shared-id")));

    expect(await loadDatabaseCredentialsAction("postgres", "shared-id")).toEqual(genericFailure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["application", "compose", "destination"])("rejects non-database type %s", async (engine) => {
    expect(await loadDatabaseCredentialsAction(engine as Engine, "id")).toEqual(genericFailure);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([null, undefined])("returns null for a missing password (%s)", async (password) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("postgres", "owned-id")))
      .mockResolvedValueOnce(Response.json({ databasePassword: password }));

    expect(await loadDatabaseCredentialsAction("postgres", "owned-id")).toEqual({ ok: true, password: null });
  });

  it("does not expose backend error details", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("private backend detail", { status: 500 }));

    expect(await loadDatabaseCredentialsAction("postgres", "id")).toEqual(genericFailure);
  });

  it("preserves a login redirect for an invalid session", async () => {
    mocks.openSession.mockReturnValue(null);

    await expect(loadDatabaseCredentialsAction("postgres", "id")).rejects.toBe(mocks.redirect);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves a login redirect when Dokploy rejects the session", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(loadDatabaseCredentialsAction("postgres", "id")).rejects.toBe(mocks.redirect);
  });
});

describe("database drawer rendering", () => {
  it("waits for the on-demand credential load instead of using the page prop", () => {
    const service: Database = {
      kind: "database",
      engine: "postgres",
      id: "database-id",
      name: "Test database",
      appName: "test-database",
      status: "idle",
      projectId: "project-id",
      projectName: "Test project",
      environmentId: "environment-id",
      environmentName: "production",
      dockerImage: "postgres:17",
      env: null,
      createdAt: null,
      cpuLimit: null,
      memoryLimit: null,
      replicas: null,
      databaseName: "test",
      databaseUser: "test",
      databasePassword: "database-credentials-prop-sentinel",
      externalPort: null,
      command: null,
    };

    const html = renderToStaticMarkup(createElement(ServiceDrawer, { service, onClose: vi.fn() }));

    expect(html).toContain("Loading database credentials…");
    expect(html).not.toContain("database-credentials-prop-sentinel");
    expect(html).not.toContain("postgresql://");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
