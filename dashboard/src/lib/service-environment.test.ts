import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDatabasePasswordAction, loadServiceEnvAction } from "../app/actions";
import { ENGINES, type Engine, type MountServiceType } from "./dokploy";

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

const serviceTypes: MountServiceType[] = ["application", "compose", ...ENGINES];
const genericFailure = { ok: false, error: "Could not load environment variables." };

function projectsWith(type: MountServiceType, id: string) {
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
      [type === "application" ? "applications" : type]: [{ [`${type}Id`]: id }],
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

describe("loadServiceEnvAction", () => {
  it.each(serviceTypes)("does not fetch %s env when the account does not own it", async (type) => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith(type, "owned-id")));

    expect(await loadServiceEnvAction(type, "other-account-id")).toEqual(genericFailure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toMatch(/\/api\/project\.all$/);
    expect(mocks.fetch.mock.calls[0][1].headers.Cookie).toBe("test-user-session");
  });

  it.each(serviceTypes)("loads owned %s env with the current user's session", async (type) => {
    const id = "owned/id?value=1";
    const env = "TOKEN=env-redaction-action-sentinel";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith(type, id)))
      .mockResolvedValueOnce(Response.json({ env }));

    expect(await loadServiceEnvAction(type, id)).toEqual({ ok: true, env });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][0]).toContain(
      `/api/${type}.one?${type}Id=${encodeURIComponent(id)}`,
    );
    expect(mocks.fetch.mock.calls[1][1].headers.Cookie).toBe("test-user-session");
  });

  it("does not accept an ID owned under another service kind", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith("compose", "shared-id")));

    expect(await loadServiceEnvAction("application", "shared-id")).toEqual(genericFailure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects service types supplied outside the runtime allowlist", async () => {
    expect(await loadServiceEnvAction("destination" as MountServiceType, "id")).toEqual(genericFailure);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ""])("normalizes empty env (%s) to an editable string", async (env) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application", "owned-id")))
      .mockResolvedValueOnce(Response.json({ env }));

    expect(await loadServiceEnvAction("application", "owned-id")).toEqual({ ok: true, env: "" });
  });

  it("does not expose backend error details", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("private backend detail", { status: 500 }));

    expect(await loadServiceEnvAction("application", "id")).toEqual(genericFailure);
  });

  it("preserves a login redirect for an invalid session", async () => {
    mocks.openSession.mockReturnValue(null);

    await expect(loadServiceEnvAction("application", "id")).rejects.toBe(mocks.redirect);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves a login redirect when Dokploy rejects the session", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(loadServiceEnvAction("application", "id")).rejects.toBe(mocks.redirect);
  });
});

describe("loadDatabasePasswordAction", () => {
  const failure = { ok: false, error: "Could not load database credentials." };

  it.each(ENGINES)("checks ownership before revealing the %s password", async (engine) => {
    const id = "owned/db?x=1";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith(engine, id)))
      .mockResolvedValueOnce(Response.json({ databasePassword: "password-sentinel", env: "TOKEN=private-env" }));

    expect(await loadDatabasePasswordAction(engine, id)).toEqual({ ok: true, password: "password-sentinel" });
    expect(mocks.fetch.mock.calls[1][0]).toContain(`/api/${engine}.one?${engine}Id=${encodeURIComponent(id)}`);
    expect(mocks.fetch.mock.calls[1][1].headers.Cookie).toBe("test-user-session");
  });

  it.each(ENGINES)("denies an unowned %s database without reading its password", async (engine) => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith(engine, "owned-id")));

    expect(await loadDatabasePasswordAction(engine, "foreign-id")).toEqual(failure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not accept ownership of the same ID under another engine", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith("mysql", "owned-id")));

    expect(await loadDatabasePasswordAction("postgres", "owned-id")).toEqual(failure);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects non-database service kinds before making requests", async () => {
    expect(await loadDatabasePasswordAction("application" as Engine, "id")).toEqual(failure);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([null, undefined])("normalizes missing passwords (%s) without fetching env", async (databasePassword) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("postgres", "id")))
      .mockResolvedValueOnce(Response.json({ databasePassword }));

    expect(await loadDatabasePasswordAction("postgres", "id")).toEqual({ ok: true, password: null });
  });

  it("does not expose upstream details when reveal fails", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith("postgres", "id")))
      .mockResolvedValueOnce(new Response("private-password", { status: 500 }));

    expect(await loadDatabasePasswordAction("postgres", "id")).toEqual(failure);
  });

  it("preserves the login redirect when the session expires", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(loadDatabasePasswordAction("postgres", "id")).rejects.toBe(mocks.redirect);
  });
});
