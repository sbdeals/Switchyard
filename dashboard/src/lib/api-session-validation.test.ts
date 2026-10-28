import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), cookie: "",
  docker: {
    runExec: vi.fn(), followLogs: vi.fn(), readRecentLogs: vi.fn(), readServiceStats: vi.fn(),
    listRuntimeStates: vi.fn(),
  },
  store: { queryLogs: vi.fn(), queryMetrics: vi.fn(), storeEnabled: vi.fn(), storeAvailable: vi.fn() },
  postgres: { listTargets: vi.fn(), resolveTarget: vi.fn(), listTables: vi.fn(), fetchRows: vi.fn(), runUserQuery: vi.fn() },
  http: vi.fn(), tags: vi.fn(),
  agent: { isAgentConfigured: vi.fn(), agentModel: vi.fn(), getOpenAI: vi.fn(), runAgentTurn: vi.fn() },
  keys: {
    resolveAgentKey: vi.fn(), resolveProvider: vi.fn(), resolveBaseUrl: vi.fn(), isLoginCredential: vi.fn(),
    maskKey: vi.fn(), setRuntimeKey: vi.fn(), setRuntimeModel: vi.fn(), setProvider: vi.fn(), setBaseUrl: vi.fn(),
    setOAuthCredential: vi.fn(), looksLikeAnthropicKey: vi.fn(),
  },
  oauth: { startLogin: vi.fn(), completeLogin: vi.fn() },
  staged: { sessionKey: vi.fn(), listStaged: vi.fn(), removeStaged: vi.fn(), applyStaged: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }) }) }));
vi.mock("./docker", () => mocks.docker);
vi.mock("./store", () => mocks.store);
vi.mock("./postgres", () => mocks.postgres);
vi.mock("./traefik-metrics", () => ({ getHttpMetrics: mocks.http }));
vi.mock("./image-tags", () => ({ getImageTags: mocks.tags }));
vi.mock("./agent/client", () => mocks.agent);
vi.mock("./agent/run", () => ({ runAgentTurn: mocks.agent.runAgentTurn }));
vi.mock("./agent/key-store", () => ({ ...mocks.keys, AGENT_MODELS: [{ id: "test-model", label: "Test" }] }));
vi.mock("./agent/oauth", () => mocks.oauth);
vi.mock("./agent/store", () => mocks.staged);
vi.mock("./agent/ops", () => ({ applyStaged: mocks.staged.applyStaged }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./environment-duplicate-server", () => ({
  duplicateOptions: (options: unknown) => options,
  duplicateError: () => "Unavailable",
  executeEnvironmentDuplicate: vi.fn(),
}));

import { sealSession, SESSION_MAX_AGE } from "./session";
import { SESSION_EXPIRED_MESSAGE } from "./action-call";
import { knownAppNamesForRequest, request as dokployRequest } from "./dokploy";
import { GET as workspace } from "../app/api/workspace/route";
import { POST as exec } from "../app/api/services/exec/route";
import { GET as logs } from "../app/api/services/logs/route";
import { GET as download } from "../app/api/services/logs/download/route";
import { POST as postgres } from "../app/api/services/postgres/route";
import { GET as httpMetrics } from "../app/api/services/http-metrics/route";
import { GET as history } from "../app/api/services/metrics/history/route";
import { GET as metrics } from "../app/api/services/metrics/route";
import { GET as configRead, POST as configWrite } from "../app/api/agent/config/route";
import { POST as chat } from "../app/api/agent/chat/route";
import { GET as models } from "../app/api/agent/models/route";
import { POST as oauthStart } from "../app/api/agent/oauth/start/route";
import { POST as oauthComplete } from "../app/api/agent/oauth/complete/route";
import { GET as changesRead, POST as changesWrite } from "../app/api/agent/changes/route";
import { GET as imageTags } from "../app/api/images/tags/route";
import { POST as duplicate } from "../app/api/environments/duplicate/route";
import { executeEnvironmentDuplicate } from "./environment-duplicate-server";

const effectMocks = [
  ...Object.values(mocks.docker), ...Object.values(mocks.store), ...Object.values(mocks.postgres),
  ...Object.values(mocks.agent), ...Object.values(mocks.keys), ...Object.values(mocks.oauth),
  ...Object.values(mocks.staged), mocks.http, mocks.tags, executeEnvironmentDuplicate,
];
const tree = (user: string) => [{
  projectId: `${user}-project`, name: user,
  environments: [{ environmentId: `${user}-env`, name: "production", applications: [{ applicationId: `${user}-id` }] }],
}];
function token(user = "alice", iat = Date.now()) {
  return sealSession({ dokployCookie: `dokploy=${user}`, email: `${user}@example.test`, iat });
}
function req(path: string, cookie: string | undefined, body?: unknown): Request {
  return new Request(`http://dashboard.test/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(cookie === undefined ? {} : { cookie: `switchyard_session=${cookie}` }),
      origin: "http://dashboard.test", host: "dashboard.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type RouteCase = { name: string; handler: (request: Request) => Promise<Response>; body?: unknown; scoped?: boolean };
const appRoutes: RouteCase[] = [
  { name: "services/exec", handler: exec, body: { app: "alice-app", command: "echo test" }, scoped: true },
  { name: "services/logs?app=alice-app", handler: logs, scoped: true },
  { name: "services/logs/download?app=alice-app", handler: download, scoped: true },
  { name: "services/postgres", handler: postgres, body: { app: "alice-app", op: "targets" }, scoped: true },
  { name: "services/http-metrics?app=alice-app", handler: httpMetrics, scoped: true },
  { name: "services/metrics/history?app=alice-app", handler: history, scoped: true },
  { name: "services/metrics?app=alice-app", handler: metrics, scoped: true },
];
// Agent endpoints have no app selector; access requires any verified session.
// Service-specific agent tools resolve their target through the user's tree.
const accountRoutes: RouteCase[] = [
  { name: "agent/config", handler: configRead },
  { name: "agent/config", handler: configWrite, body: { key: "sk-ant-test-only-key" } },
  { name: "agent/chat", handler: chat, body: { messages: [{ role: "user", content: "List my services" }] } },
  { name: "agent/models", handler: models },
  { name: "agent/oauth/start", handler: oauthStart, body: {} },
  { name: "agent/oauth/complete", handler: oauthComplete, body: { code: "test-code" } },
  { name: "agent/changes", handler: changesRead },
  { name: "agent/changes", handler: changesWrite, body: { action: "apply" } },
  { name: "images/tags?image=nginx", handler: imageTags },
];
const duplicateRoute: RouteCase = {
  name: "environments/duplicate", handler: duplicate, scoped: true,
  body: { options: { projectId: "alice-project", sourceEnvironmentId: "alice-env", name: "copy" }, fingerprint: "a".repeat(64) },
};
async function invoke(route: RouteCase, cookie: string | undefined) {
  mocks.cookie = cookie ?? "";
  const response = await route.handler(req(route.name, cookie, route.body));
  // Drain successful SSE/downloads so each request is fully finished before the next.
  if (response.status === 200) await response.text();
  return response;
}
async function warm(route: RouteCase) {
  expect((await invoke(route, token())).status).toBe(200);
  expect(mocks.fetch).toHaveBeenCalled();
  vi.clearAllMocks();
}
function expectNoEffects() {
  for (const mock of effectMocks) expect(mock).not.toHaveBeenCalled();
}

let testNow = Date.now();
beforeEach(() => {
  vi.resetAllMocks();
  // Keep tests independent while exercising the real module-level name cache.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(testNow += 31_000);
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "api-auth-test-secret");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    const cookie = new Headers(init.headers).get("cookie");
    if (cookie !== "dokploy=alice" && cookie !== "dokploy=bob") throw new Error("Unexpected credentials");
    const user = cookie.slice("dokploy=".length);
    if (url.endsWith("/api/project.all")) return Response.json(tree(user));
    if (url.endsWith(`/api/application.one?applicationId=${user}-id`)) {
      return Response.json({ appName: `${user}-app`, name: user });
    }
    throw new Error(`Unexpected Dokploy request: ${url}`);
  });
  mocks.docker.runExec.mockResolvedValue({ stdout: "test", stderr: "", exitCode: 0, truncated: false });
  mocks.docker.followLogs.mockResolvedValue(null);
  mocks.docker.readRecentLogs.mockResolvedValue([{ ts: 1, text: "log" }]);
  mocks.docker.readServiceStats.mockResolvedValue({ sample: null, status: "not-running", containers: 0 });
  mocks.store.queryLogs.mockResolvedValue([]);
  mocks.store.queryMetrics.mockResolvedValue([]);
  mocks.store.storeEnabled.mockReturnValue(true);
  mocks.store.storeAvailable.mockReturnValue(true);
  mocks.postgres.listTargets.mockResolvedValue([]);
  mocks.http.mockReturnValue({ available: true, points: [] });
  mocks.tags.mockResolvedValue({ tags: [], available: true });
  mocks.agent.isAgentConfigured.mockReturnValue(true);
  mocks.agent.agentModel.mockReturnValue("test-model");
  mocks.agent.runAgentTurn.mockResolvedValue(undefined);
  mocks.keys.resolveProvider.mockReturnValue("anthropic");
  mocks.keys.resolveAgentKey.mockReturnValue({ key: "test-key", source: "runtime" });
  mocks.keys.maskKey.mockReturnValue("masked");
  mocks.keys.looksLikeAnthropicKey.mockReturnValue(true);
  mocks.oauth.startLogin.mockReturnValue({ url: "https://provider.test/authorize" });
  mocks.oauth.completeLogin.mockResolvedValue({ accessToken: "test-access", refreshToken: "test-refresh" });
  mocks.staged.sessionKey.mockReturnValue("hashed-session");
  mocks.staged.listStaged.mockReturnValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe.each([...appRoutes, ...accountRoutes, duplicateRoute])("$name ($body)", (route) => {
  it.each([undefined, "x", "garbage"])("rejects absent/forged %s after a successful owner request, without backend or side effects", async (cookie) => {
    await warm(route);
    const response = await invoke(route, cookie);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: SESSION_EXPIRED_MESSAGE, code: "unauthenticated" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expectNoEffects();
  });

  it("rejects expired sealed sessions after warming, before contacting Dokploy", async () => {
    await warm(route);
    const response = await invoke(route, token("alice", Date.now() - SESSION_MAX_AGE * 1000));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: SESSION_EXPIRED_MESSAGE, code: "unauthenticated" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expectNoEffects();
  });

  it("revalidates a revoked Dokploy session even immediately after success", async () => {
    const cookie = token();
    expect((await invoke(route, cookie)).status).toBe(200);
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(new Response("revoked", { status: 401 }));
    expect((await invoke(route, cookie)).status).toBe(401);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expectNoEffects();
  });

  it.each(["network", "timeout", "http", "malformed"])("fails closed during Dokploy %s failure after warming", async (failure) => {
    await warm(route);
    if (failure === "network") mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    else if (failure === "timeout") mocks.fetch.mockRejectedValue(new DOMException("deadline", "TimeoutError"));
    else if (failure === "http") mocks.fetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
    else mocks.fetch.mockResolvedValue(Response.json(null));
    const response = await invoke(route, token());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Workspace unavailable.", code: "unavailable" });
    expectNoEffects();
  });

  it(route.scoped ? "denies another valid user the warmed owner's app" : "validates a different session with that user's own cookie", async () => {
    await warm(route);
    const response = await invoke(route, token("bob"));
    expect(response.status).toBe(route.scoped ? 403 : 200);
    if (route.scoped) {
      expect(await response.json()).toMatchObject({ error: expect.any(String), code: "forbidden" });
    }
    expect(mocks.fetch).toHaveBeenCalled();
    for (const [, init] of mocks.fetch.mock.calls) expect(new Headers(init.headers).get("cookie")).toBe("dokploy=bob");
    if (route.scoped) expectNoEffects();
  });

  it("preserves successful owner behavior and authenticates before effects", async () => {
    expect((await invoke(route, token())).status).toBe(200);
    const expected = route.handler === exec ? mocks.docker.runExec
      : route.handler === logs ? mocks.docker.followLogs
      : route.handler === download ? mocks.docker.readRecentLogs
      : route.handler === postgres ? mocks.postgres.listTargets
      : route.handler === httpMetrics ? mocks.http
      : route.handler === history ? mocks.store.queryMetrics
      : route.handler === metrics ? mocks.docker.readServiceStats
      : route.handler === configRead ? mocks.keys.resolveAgentKey
      : route.handler === configWrite ? mocks.keys.setRuntimeKey
      : route.handler === chat ? mocks.agent.runAgentTurn
      : route.handler === models ? mocks.keys.resolveProvider
      : route.handler === oauthStart ? mocks.oauth.startLogin
      : route.handler === oauthComplete ? mocks.keys.setOAuthCredential
      : route.handler === imageTags ? mocks.tags
      : route.handler === duplicate ? executeEnvironmentDuplicate
      : mocks.staged.listStaged;
    expect(expected).toHaveBeenCalled();
    const authOrder = mocks.fetch.mock.invocationCallOrder[0];
    for (const mock of effectMocks) {
      for (const order of vi.mocked(mock).mock.invocationCallOrder) expect(order).toBeGreaterThan(authOrder);
    }
  });
});

describe("request isolation and API/action compatibility", () => {
  it("does not reuse ownership after it is removed from an otherwise valid session", async () => {
    await warm(appRoutes[0]);
    mocks.fetch.mockResolvedValue(Response.json([]));
    expect((await invoke(appRoutes[0], token())).status).toBe(403);
    expectNoEffects();
  });

  it("isolates simultaneous owner lookups, including application, compose and database IDs", async () => {
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const user = new Headers(init.headers).get("cookie")!.slice(8);
      if (url.endsWith("/api/project.all")) return Response.json([{
        projectId: user, environments: [{ environmentId: user, applications: [{ applicationId: `${user}-app` }],
          compose: [{ composeId: `${user}-stack` }], postgres: [{ postgresId: `${user}-db` }] }],
      }]);
      const id = new URL(url).searchParams.values().next().value;
      expect(id).toMatch(new RegExp(`^${user}-`));
      return Response.json({ appName: id });
    });
    const [alice, bob] = await Promise.all(["alice", "bob"].map((user) => knownAppNamesForRequest(req("", token(user)))));
    expect(alice).toEqual(new Set(["alice-app", "alice-stack", "alice-db"]));
    expect(bob).toEqual(new Set(["bob-app", "bob-stack", "bob-db"]));
    expectNoEffects();
  });

  it("does not access the store even when history is disabled until authorization succeeds", async () => {
    await warm(appRoutes[5]);
    mocks.store.storeEnabled.mockReturnValue(false);
    expect((await invoke(appRoutes[5], "x")).status).toBe(401);
    expectNoEffects();
  });

  it.each([401, 503])("fails closed if a service detail lookup returns %s", async (status) => {
    await warm(appRoutes[0]);
    vi.setSystemTime(Date.now() + 30_000);
    mocks.fetch.mockImplementation(async (url: string) => url.endsWith("/api/project.all")
      ? Response.json(tree("alice")) : new Response("failed", { status }));
    expect((await invoke(appRoutes[0], token())).status).toBe(status);
    expectNoEffects();
  });

  it("converts real authentication redirects at the API boundary but retains them for Server Actions", async () => {
    mocks.cookie = "x";
    expect((await workspace()).status).toBe(401);
    await expect(dokployRequest("project.all")).rejects.toMatchObject({ digest: expect.stringContaining(";/login;") });
    mocks.cookie = token();
    mocks.fetch.mockResolvedValue(new Response("expired", { status: 401 }));
    expect((await workspace()).status).toBe(401);
    await expect(dokployRequest("project.all")).rejects.toMatchObject({ digest: expect.stringContaining(";/api/session/expired;") });
    expectNoEffects();
  });
});
