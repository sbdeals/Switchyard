import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => { throw new Error("Request cookie required"); }) }));
vi.mock("./docker", () => ({}));

const fetchMock = vi.fn();
let names: typeof import("./dokploy").knownAppNamesForRequest;
let seal: typeof import("./session").sealSession;
let ids: string[];
function request(user = "alice", token?: string) {
  return new Request("http://dashboard.test", { headers: {
    cookie: `switchyard_session=${token ?? seal({ dokployCookie: `dokploy=${user}`, email: `${user}@example.test` })}`,
  } });
}
function detailCalls() {
  return fetchMock.mock.calls.filter(([url]) => !url.endsWith("/api/project.all"));
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "name-cache-test-secret");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  ids = ["service-id"];
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const user = new Headers(init.headers).get("cookie")!.slice("dokploy=".length);
    if (url.endsWith("/api/project.all")) return Response.json([{
      projectId: user, environments: [{ environmentId: `${user}-env`, applications: ids.map((applicationId) => ({ applicationId })) }],
    }]);
    const id = new URL(url).searchParams.get("applicationId");
    return Response.json({ appName: `${user}-${id}` });
  });
  names = (await import("./dokploy")).knownAppNamesForRequest;
  seal = (await import("./session")).sealSession;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("verified-session app name cache", () => {
  it("reuses detail resolutions while checking project.all with the caller's cookie on every request", async () => {
    expect(await names(request())).toEqual(new Set(["alice-service-id"]));
    fetchMock.mockClear();
    // Re-sealing the same backend session still shares its safe resolution cache.
    expect(await names(request())).toEqual(new Set(["alice-service-id"]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/project\.all$/);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("cookie")).toBe("dokploy=alice");
  });

  it("never gives a second valid session the first user's names, even for identical service IDs", async () => {
    await names(request("alice"));
    fetchMock.mockClear();
    expect(await names(request("bob"))).toEqual(new Set(["bob-service-id"]));
    expect(detailCalls()).toHaveLength(1);
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init.headers).get("cookie")).toBe("dokploy=bob");
    expect(await names(request("alice"))).toEqual(new Set(["alice-service-id"]));
  });

  it.each(["x", "garbage"])("rejects forged %s before backend validation or cache use after warming", async (token) => {
    await names(request());
    fetchMock.mockClear();
    await expect(names(request("alice", token))).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 503])("never serves cached names after a project.all %s", async (status) => {
    await names(request());
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await expect(names(request())).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(detailCalls()).toHaveLength(0);
  });

  it("drops removed service names immediately, while retaining cached names for IDs still in the fresh tree", async () => {
    ids = ["removed", "retained"];
    await names(request());
    fetchMock.mockClear();
    ids = ["retained"];
    expect(await names(request())).toEqual(new Set(["alice-retained"]));
    expect(detailCalls()).toHaveLength(0);
  });

  it("resolves a transferred service under its new owner's cookie and revokes the old owner's access", async () => {
    await names(request("alice"));
    fetchMock.mockClear();
    expect(await names(request("bob"))).toEqual(new Set(["bob-service-id"]));
    ids = [];
    expect(await names(request("alice"))).toEqual(new Set());
    expect(detailCalls()).toHaveLength(1);
  });

  it("expires resolutions at 30 seconds without extending the TTL on hits", async () => {
    await names(request());
    fetchMock.mockClear();
    vi.setSystemTime(Date.now() + 29_999);
    await names(request());
    expect(detailCalls()).toHaveLength(0);
    vi.setSystemTime(Date.now() + 1);
    await names(request());
    expect(detailCalls()).toHaveLength(1);
  });

  it("bounds the process-wide cache to 500 entries and evicts the least recently used entry", async () => {
    ids = Array.from({ length: 500 }, (_, i) => `id-${i}`);
    await names(request());
    expect(detailCalls()).toHaveLength(500);
    ids = ["id-0"];
    await names(request()); // Protect this recently used entry.
    ids = ["id-500"];
    await names(request()); // Evict id-1.
    fetchMock.mockClear();
    ids = ["id-0", "id-500"];
    await names(request());
    expect(detailCalls()).toHaveLength(0);
    ids = ["id-1"];
    await names(request());
    expect(detailCalls()).toHaveLength(1);
  });

  it("does not cache failed or incomplete resolutions", async () => {
    fetchMock.mockImplementationOnce(async () => Response.json([{
      projectId: "alice", environments: [{ applications: [{ applicationId: "service-id" }] }],
    }])).mockResolvedValueOnce(Response.json({}));
    expect(await names(request())).toEqual(new Set());
    expect(await names(request())).toEqual(new Set(["alice-service-id"]));
    expect(detailCalls()).toHaveLength(2);
  });
});
