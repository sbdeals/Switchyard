import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), cookies: vi.fn(), sampleStatsOnce: vi.fn(), readRecentLogs: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("./docker", () => ({
  listRuntimeStates: vi.fn(async () => ({ compose: new Map(), swarm: new Map() })),
  deriveSwarmRuntime: vi.fn(), deriveComposeRuntime: vi.fn(),
  sampleStatsOnce: mocks.sampleStatsOnce, readRecentLogs: mocks.readRecentLogs,
}));
vi.mock("./store", () => ({
  storeEnabled: () => true, writeMetric: vi.fn(), writeLogs: vi.fn(), pruneOld: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  delete (globalThis as { __switchyardCollector?: unknown }).__switchyardCollector;
  vi.stubEnv("DOKPLOY_EMAIL", "collector@example.test");
  vi.stubEnv("DOKPLOY_PASSWORD", "collector-test-password");
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "collector-isolation-test-secret");
  vi.stubEnv("SWITCHYARD_ALERTS", "off");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.cookies.mockRejectedValue(new Error("No request context"));
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/auth/sign-in/email")) {
      return new Response("{}", { headers: { "set-cookie": "dokploy=collector; Path=/; HttpOnly" } });
    }
    expect(new Headers(init.headers).get("cookie")).toBe("dokploy=collector");
    if (url.endsWith("/api/project.all")) return Response.json([]);
    throw new Error("Unexpected backend request");
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("explicit collector session", () => {
  it.each(["DOKPLOY_EMAIL", "DOKPLOY_PASSWORD"])("reports disabled collection without %s and never borrows a user's session", async (missing) => {
    vi.stubEnv(missing, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ensureCollector } = await import("./collector");
    ensureCollector();
    ensureCollector();
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("DOKPLOY_EMAIL and DOKPLOY_PASSWORD"));
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sampleStatsOnce).not.toHaveBeenCalled();
    expect(mocks.readRecentLogs).not.toHaveBeenCalled();
  });

  it("loads a workspace without a user request, and never falls back to it on the user path", async () => {
    const { withSystemSession, loadWorkspace, request } = await import("./dokploy");
    expect(await withSystemSession(() => loadWorkspace({ includeRuntime: false })))
      .toEqual({ services: [], projects: [] });
    expect(mocks.cookies).not.toHaveBeenCalled();
    mocks.fetch.mockClear();
    await expect(request("project.all")).rejects.toThrow("No request context");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps API validation on the supplied user cookie even inside a collector context", async () => {
    const { withSystemSession, verifySessionForRequest } = await import("./dokploy");
    const { sealSession } = await import("./session");
    const token = sealSession({ dokployCookie: "dokploy=user", email: "user@example.test" });
    await withSystemSession(async () => {
      mocks.fetch.mockClear();
      const forged = new Request("http://dashboard.test", { headers: { cookie: "switchyard_session=x" } });
      await expect(verifySessionForRequest(forged)).rejects.toMatchObject({ status: 401 });
      expect(mocks.fetch).not.toHaveBeenCalled();
      mocks.fetch.mockImplementation(async (_url, init: RequestInit) => {
        expect(new Headers(init.headers).get("cookie")).toBe("dokploy=user");
        return Response.json([]);
      });
      await verifySessionForRequest(new Request("http://dashboard.test", { headers: { cookie: `switchyard_session=${token}` } }));
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it("clears a revoked collector session and signs in again on the next tick", async () => {
    const { withSystemSession, loadWorkspace } = await import("./dokploy");
    await withSystemSession(() => loadWorkspace({ includeRuntime: false }));
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(withSystemSession(() => loadWorkspace({ includeRuntime: false })))
      .rejects.toMatchObject({ status: 401 });
    await withSystemSession(() => loadWorkspace({ includeRuntime: false }));
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/api/auth/sign-in/email"))).toHaveLength(2);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("runs actual collector ticks with its own credentials and no request context", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/api/auth/sign-in/email")) {
        return new Response("{}", { headers: { "set-cookie": "dokploy=collector; Path=/" } });
      }
      expect(new Headers(init.headers).get("cookie")).toBe("dokploy=collector");
      return url.endsWith("/api/project.all")
        ? Response.json([{ projectId: "system", name: "system", environments: [{ environmentId: "env", name: "env", applications: [{ applicationId: "app" }] }] }])
        : Response.json({ appName: "system-app" });
    });
    mocks.sampleStatsOnce.mockResolvedValue(null);
    mocks.readRecentLogs.mockResolvedValue([]);
    const { ensureCollector } = await import("./collector");
    ensureCollector();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.sampleStatsOnce).toHaveBeenCalledWith("system-app");
    expect(mocks.readRecentLogs).toHaveBeenCalledWith("system-app", 100);
    expect(mocks.cookies).not.toHaveBeenCalled();
    vi.clearAllTimers();
  });
});
