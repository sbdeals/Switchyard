import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: "",
  deleteCookie: vi.fn(),
  fetch: vi.fn(),
  startLogin: vi.fn(() => ({ url: "https://provider.example.test/authorize" })),
  completeLogin: vi.fn(async () => ({ access: "synthetic", refresh: "synthetic", expiresAt: 1 })),
  setOAuthCredential: vi.fn(),
  setRuntimeKey: vi.fn(),
  setProvider: vi.fn(),
  setBaseUrl: vi.fn(),
  setRuntimeModel: vi.fn(),
  resolveAgentKey: vi.fn(() => null),
  getOpenAI: vi.fn(),
  runAgentTurn: vi.fn(async () => {}),
  applyStaged: vi.fn(),
  listStaged: vi.fn(() => [{ id: "fixture", kind: "stop_service", description: "Fixture change", createdAt: 1, params: {} }]),
  removeStaged: vi.fn(() => []),
  takeStaged: vi.fn(() => [{ id: "fixture", kind: "stop_service", description: "Fixture change", createdAt: 1, params: {} }]),
}));

// Exercise the real envelope, Dokploy identity lookup and route gates. All
// provider credentials, tools and deployment operations stay behind mocks.
vi.mock("../docker", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: mocks.token }), delete: mocks.deleteCookie }),
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT"); } }));
vi.mock("./oauth", () => ({ startLogin: mocks.startLogin, completeLogin: mocks.completeLogin }));
vi.mock("./client", () => ({
  isAgentConfigured: () => true,
  agentModel: () => "fixture-model",
  getOpenAI: mocks.getOpenAI,
}));
vi.mock("./key-store", () => ({
  AGENT_MODELS: [],
  resolveProvider: () => "anthropic",
  resolveBaseUrl: () => null,
  resolveAgentKey: mocks.resolveAgentKey,
  isLoginCredential: () => false,
  setOAuthCredential: mocks.setOAuthCredential,
  setRuntimeKey: mocks.setRuntimeKey,
  setProvider: mocks.setProvider,
  setBaseUrl: mocks.setBaseUrl,
  setRuntimeModel: mocks.setRuntimeModel,
}));
vi.mock("./run", () => ({ runAgentTurn: mocks.runAgentTurn }));
vi.mock("./ops", () => ({ applyStaged: mocks.applyStaged }));
vi.mock("./store", () => ({
  sessionKey: () => "fixture-session",
  listStaged: mocks.listStaged,
  removeStaged: mocks.removeStaged,
  takeStaged: mocks.takeStaged,
}));

import { SESSION_COOKIE, SESSION_MAX_AGE, sealSession } from "../session";

let requireActiveAgentSession: typeof import("./session")["requireActiveAgentSession"];

type Route = { name: string; method: "GET" | "POST"; handler: (req: Request) => Promise<Response>; body?: unknown };
const routes: Route[] = [
  { name: "config GET", method: "GET", handler: async (req) => (await import("@/app/api/agent/config/route")).GET(req) },
  { name: "config POST", method: "POST", body: { clear: true }, handler: async (req) => (await import("@/app/api/agent/config/route")).POST(req) },
  { name: "models GET", method: "GET", handler: async (req) => (await import("@/app/api/agent/models/route")).GET(req) },
  { name: "OAuth start", method: "POST", handler: async (req) => (await import("@/app/api/agent/oauth/start/route")).POST(req) },
  { name: "OAuth complete", method: "POST", body: { code: "fixture-code" }, handler: async (req) => (await import("@/app/api/agent/oauth/complete/route")).POST(req) },
  { name: "chat POST", method: "POST", body: { messages: [{ role: "user", content: "hello" }] }, handler: async (req) => (await import("@/app/api/agent/chat/route")).POST(req) },
  { name: "changes GET", method: "GET", handler: async (req) => (await import("@/app/api/agent/changes/route")).GET(req) },
  { name: "changes apply", method: "POST", body: { action: "apply", ids: ["fixture"] }, handler: async (req) => (await import("@/app/api/agent/changes/route")).POST(req) },
  { name: "changes discard", method: "POST", body: { action: "discard" }, handler: async (req) => (await import("@/app/api/agent/changes/route")).POST(req) },
];

function request(route = routes[0], token = mocks.token) {
  return new Request("http://dashboard.test/api/agent/fixture", {
    method: route.method,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
    body: route.body === undefined ? undefined : JSON.stringify(route.body),
  });
}

function expectNoAgentAccess() {
  for (const fn of [
    mocks.startLogin, mocks.completeLogin, mocks.setOAuthCredential, mocks.setRuntimeKey,
    mocks.setProvider, mocks.setBaseUrl, mocks.setRuntimeModel, mocks.resolveAgentKey,
    mocks.getOpenAI, mocks.runAgentTurn, mocks.applyStaged, mocks.listStaged, mocks.removeStaged, mocks.takeStaged,
  ]) expect(fn).not.toHaveBeenCalled();
}

function expectOwnSessionLookup() {
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledWith("http://dokploy.test/api/user.get", expect.objectContaining({
    headers: { Origin: "http://dokploy.test", Cookie: "sess=agent-fixture" },
    cache: "no-store",
    redirect: "error",
    signal: expect.any(AbortSignal),
  }));
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DOKPLOY_URL", "http://dokploy.test");
  vi.stubEnv("DOKPLOY_AUTH_ORIGIN", "");
  vi.stubEnv("DOKPLOY_ORIGIN", "http://other-origin.test");
  vi.stubEnv("SWITCHYARD_ASSUME_HTTPS", "");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockReset().mockImplementation(async () => Response.json({ role: "admin" }));
  mocks.token = sealSession({ dokployCookie: "sess=agent-fixture", email: "fixture@example.test", iat: Date.now() });
  ({ requireActiveAgentSession } = await import("./session"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each([401, 403])("Dokploy HTTP %i revokes agent access", (status) => {
  it.each(routes)("$name clears the envelope and has no agent side effects", async (route) => {
    mocks.fetch.mockImplementation(async () => new Response("rejected", { status }));
    const response = await route.handler(request(route));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Session expired. Sign in again at /login." });
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=; Path=/; Max-Age=0;`);
    expectOwnSessionLookup();
    expectNoAgentAccess();
  });
});

describe.each(["network", "timeout", 500, 503])("Dokploy failure %s", (failure) => {
  it.each(routes)("$name fails closed with 503 and retains the cookie for retry", async (route) => {
    mocks.fetch.mockImplementation(async () => {
      if (failure === "network") throw new Error("ECONNREFUSED");
      if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
      return new Response("unavailable", { status: failure as number });
    });
    const response = await route.handler(request(route));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Could not verify your session") });
    expect(response.headers.get("set-cookie")).toBeNull();
    expectOwnSessionLookup();
    expectNoAgentAccess();
  });
});

it.each(routes)("a live session still serves $name with one identity lookup", async (route) => {
  const response = await route.handler(request(route));
  expect(response.status).toBe(200);
  await response.text();
  expect(response.headers.get("set-cookie")).toBeNull();
  expectOwnSessionLookup();
});

it.each(["missing", "forged", "expired", "empty Dokploy cookie"])("rejects a %s envelope before contacting Dokploy", async (kind) => {
  const token = kind === "missing" ? "" : kind === "forged" ? "forged" : sealSession({
    dokployCookie: kind === "expired" ? "sess=fixture" : "",
    email: "fixture@example.test",
    iat: kind === "expired" ? Date.now() - SESSION_MAX_AGE * 1000 - 1_000 : Date.now(),
  });
  const result = await requireActiveAgentSession(request(routes[0], token));
  expect(result).toMatchObject({ response: expect.objectContaining({ status: 401 }) });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it.each([null, {}, { user: { role: "owner" } }])("returns 503 without clearing the cookie for an unrecognizable identity: %j", async (body) => {
  mocks.fetch.mockResolvedValue(Response.json(body));
  const response = await routes[0].handler(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("set-cookie")).toBeNull();
  expectOwnSessionLookup();
  expectNoAgentAccess();
});

it.each(routes)("$name returns 503 without clearing the cookie when every origin is invalid", async (route) => {
  mocks.fetch.mockImplementation(async () => Response.json({ code: "INVALID_ORIGIN" }, { status: 403 }));
  const response = await route.handler(request(route));
  expect(response.status).toBe(503);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.fetch.mock.calls.map(([, init]) => new Headers(init.headers).get("origin")))
    .toEqual(["http://dokploy.test", "http://other-origin.test"]);
  for (const [, init] of mocks.fetch.mock.calls) {
    expect(new Headers(init.headers).get("cookie")).toBe("sess=agent-fixture");
  }
  expectNoAgentAccess();
});

it.each(routes.slice(0, 2))("$name retries INVALID_ORIGIN and reuses the successful origin and role", async (route) => {
  mocks.fetch.mockResolvedValueOnce(Response.json({ code: "INVALID_ORIGIN" }, { status: 403 }));
  const response = await route.handler(request(route));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await response.json()).toMatchObject({ canConfigure: true });
  expect(mocks.fetch).toHaveBeenCalledTimes(2); // Origin retry; no separate role lookup.
  expect((await route.handler(request(route))).status).toBe(200);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  expect(mocks.fetch.mock.calls.map(([, init]) => new Headers(init.headers).get("origin")))
    .toEqual(["http://dokploy.test", "http://other-origin.test", "http://other-origin.test"]);
  for (const [, init] of mocks.fetch.mock.calls) {
    expect(new Headers(init.headers).get("cookie")).toBe("sess=agent-fixture");
  }
});

it.each([
  { status: 401, expected: 401 },
  { status: 403, expected: 401 },
  { status: 500, expected: 503 },
])("maps HTTP $status after an origin retry to $expected", async ({ status, expected }) => {
  mocks.fetch.mockResolvedValueOnce(Response.json({ code: "INVALID_ORIGIN" }, { status: 403 }))
    .mockResolvedValueOnce(new Response("upstream failure", { status }));
  const response = await routes[0].handler(request());
  expect(response.status).toBe(expected);
  if (expected === 401) {
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  } else {
    expect(response.headers.get("set-cookie")).toBeNull();
  }
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expectNoAgentAccess();
});

it.each([false, true])("clears rejected cookies with the request's Secure setting (%s)", async (secure) => {
  const req = request();
  req.headers.set("x-forwarded-proto", secure ? "https" : "http");
  mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }));
  const response = await routes[0].handler(req);
  expect(response.headers.get("set-cookie")?.includes("; Secure")).toBe(secure);
});

it("never caches a positive or negative lookup, so revocation and recovery are immediate", async () => {
  expect((await routes[0].handler(request())).status).toBe(200);
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
  expect((await routes[0].handler(request())).status).toBe(401);
  expect((await routes[0].handler(request())).status).toBe(200);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});

it("rejects a copied envelope immediately after logout revokes its backing session", async () => {
  let revoked = false;
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("cookie")).toBe("sess=agent-fixture");
    if (url === "http://dokploy.test/api/auth/sign-out") {
      revoked = true;
      return Response.json({});
    }
    expect(url).toBe("http://dokploy.test/api/user.get");
    return revoked ? new Response(null, { status: 401 }) : Response.json({ role: "admin" });
  });
  expect((await routes[0].handler(request())).status).toBe(200);
  const { logoutAction } = await import("@/app/login/actions");
  await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.deleteCookie).toHaveBeenCalledWith(SESSION_COOKIE);
  const response = await routes[0].handler(request());
  expect(response.status).toBe(401);
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});
