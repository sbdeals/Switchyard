import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// All credentials and persistence are synthetic. No real key files or provider
// calls are used, including when the real SDK clients are exercised below.
const mocks = vi.hoisted(() => ({
  file: null as string | null,
  write: vi.fn(),
  role: vi.fn(),
  fetch: vi.fn(),
  refresh: vi.fn(),
  start: vi.fn(() => ({ url: "https://claude.ai/fixture" })),
  complete: vi.fn(),
  turn: vi.fn(async () => {}),
}));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: () => {
      if (mocks.file === null) throw new Error("ENOENT");
      return mocks.file;
    },
    mkdirSync: () => {},
    writeFileSync: (_path: string, body: string) => { mocks.file = body; mocks.write(body); },
    rmSync: () => { mocks.file = null; },
  },
}));
vi.mock("@/lib/dokploy", () => ({
  getDokployRole: mocks.role,
  DokploySessionExpiredError: class extends Error {},
}));
vi.mock("./oauth", () => ({ refreshLogin: mocks.refresh, startLogin: mocks.start, completeLogin: mocks.complete }));
vi.mock("./run", () => ({ runAgentTurn: mocks.turn }));

type Store = typeof import("./key-store");
let store: Store;
let client: typeof import("./client");
let config: typeof import("@/app/api/agent/config/route");
let models: typeof import("@/app/api/agent/models/route");
let chat: typeof import("@/app/api/agent/chat/route");
let oauthStart: typeof import("@/app/api/agent/oauth/start/route");
let oauthComplete: typeof import("@/app/api/agent/oauth/complete/route");
let cookie: string;
const key = "synthetic-provider-credential";
const endpoint = "https://models.example.test/v1";
const otherEndpoint = "https://other.example.test/v1";
const oauth = { access: "sk-ant-oat-synthetic", refresh: "synthetic-refresh", expiresAt: 1 };
const globals = globalThis as typeof globalThis & { __switchyardAgentKey?: unknown };
const persisted = () => JSON.parse(mocks.file ?? "{}");

function request(method = "GET", body?: unknown) {
  return new Request("http://dashboard.test/api/agent/fixture", {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function reloadStore() {
  delete globals.__switchyardAgentKey;
  vi.resetModules();
  return import("./key-store");
}

function configureOpenAI() {
  store.setProvider("openai");
  store.setBaseUrl(endpoint);
  store.setRuntimeModel("fixture-model");
  store.setRuntimeKey(key);
  mocks.write.mockClear();
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  delete globals.__switchyardAgentKey;
  mocks.file = null;
  // Stub every provider credential/override the SDKs could otherwise inherit.
  for (const name of [
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_WEBHOOK_SIGNING_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_LOG",
    "OPENAI_API_KEY", "OPENAI_ADMIN_KEY", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID", "OPENAI_WEBHOOK_SECRET", "OPENAI_BASE_URL", "OPENAI_LOG",
    "SWITCHYARD_AGENT_PROVIDER", "SWITCHYARD_AGENT_BASE_URL", "SWITCHYARD_AGENT_MODEL",
  ]) vi.stubEnv(name, "");
  vi.stubEnv("SWITCHYARD_AGENT_KEY_FILE", "/synthetic/agent-key.json");
  mocks.role.mockReset().mockResolvedValue("admin");
  mocks.refresh.mockReset().mockResolvedValue({ ...oauth, access: "sk-ant-oat-refreshed", expiresAt: Date.now() + 3600_000 });
  mocks.complete.mockReset().mockResolvedValue(oauth);
  mocks.fetch.mockReset().mockImplementation(async () => Response.json({ data: [{ id: "fixture-model" }] }));
  vi.stubGlobal("fetch", mocks.fetch);
  store = await import("./key-store");
  client = await import("./client");
  config = await import("@/app/api/agent/config/route");
  models = await import("@/app/api/agent/models/route");
  chat = await import("@/app/api/agent/chat/route");
  oauthStart = await import("@/app/api/agent/oauth/start/route");
  oauthComplete = await import("@/app/api/agent/oauth/complete/route");
  const { SESSION_COOKIE, sealSession } = await import("../session");
  cookie = `${SESSION_COOKIE}=${sealSession({ dokployCookie: "sess=fixture", email: "fixture@example.test", iat: Date.now() })}`;
});

afterEach(() => {
  delete globals.__switchyardAgentKey;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("global agent configuration authorization", () => {
  it.each([
    { provider: "anthropic" }, { baseUrl: otherEndpoint }, { model: "other-model" }, { key: "replacement-key" }, { clear: true },
  ])("denies member POST %j before touching the shared key", async (body) => {
    configureOpenAI();
    const before = mocks.file;
    mocks.role.mockResolvedValue("member");
    const response = await config.POST(request("POST", body));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only workspace admins can change the agent provider." });
    expect(mocks.file).toBe(before);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(store.resolveAgentKey()?.key).toBe(key);
  });

  it("denies config and both OAuth routes when the role lookup fails", async () => {
    configureOpenAI();
    const before = mocks.file;
    mocks.role.mockRejectedValue(new Error("Dokploy unavailable"));
    for (const handler of [config.POST, oauthStart.POST, oauthComplete.POST]) {
      const response = await handler(request("POST", { clear: true, code: "fixture-code" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("Could not verify") });
    }
    expect(mocks.file).toBe(before);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("denies members both OAuth connect routes", async () => {
    mocks.role.mockResolvedValue("member");
    expect((await oauthStart.POST(request("POST"))).status).toBe(403);
    expect((await oauthComplete.POST(request("POST", { code: "fixture-code" }))).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"])("allows %s OAuth connect and disconnect", async (role) => {
    mocks.role.mockResolvedValue(role);
    expect((await oauthStart.POST(request("POST"))).status).toBe(200);
    expect((await oauthComplete.POST(request("POST", { code: "fixture-code" }))).status).toBe(200);
    expect(store.isLoginCredential()).toBe(true);
    expect(persisted().binding).toEqual({ provider: "anthropic", baseUrl: "https://api.anthropic.com" });
    expect((await config.POST(request("POST", { clear: true }))).status).toBe(200);
    expect(store.resolveAgentKey()).toBeNull();
    expect(persisted().oauth).toBeUndefined();
  });

  it("keeps non-secret status, model listing and chat available to members", async () => {
    configureOpenAI();
    mocks.role.mockResolvedValue("member");
    const status = await config.GET(request());
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body).toMatchObject({ canConfigure: false, configured: true, provider: "openai", model: "fixture-model" });
    expect(JSON.stringify(body)).not.toContain(key);
    expect((await models.GET(request())).status).toBe(200);
    const response = await chat.POST(request("POST", { messages: [{ role: "user", content: "hello" }] }));
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.turn).toHaveBeenCalledTimes(1);
    expect(mocks.role).toHaveBeenCalledTimes(3); // Every route verifies its Dokploy session.
  });

  it("withholds configuration status when Dokploy is unavailable", async () => {
    configureOpenAI();
    mocks.role.mockRejectedValue(new Error("offline"));
    const response = await config.GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: expect.stringContaining("Could not verify") });
  });
});

describe("credential binding on all provider uses", () => {
  it("clears an old key on admin endpoint change, blocking models and chat even with an env fallback", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-env-key");
    vi.stubEnv("SWITCHYARD_AGENT_PROVIDER", "openai");
    vi.stubEnv("SWITCHYARD_AGENT_BASE_URL", otherEndpoint);
    configureOpenAI();
    // Populate the client cache before changing the endpoint.
    client.getOpenAI();
    const response = await config.POST(request("POST", { baseUrl: otherEndpoint }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configured: false, canConfigure: true });
    expect(store.resolveAgentKey()).toBeNull();
    expect(persisted()).not.toHaveProperty("key");
    expect(persisted()).not.toHaveProperty("oauth");
    await models.GET(request());
    expect((await chat.POST(request("POST", { messages: [{ role: "user", content: "hello" }] }))).status).toBe(503);
    expect(() => client.getOpenAI()).toThrow(/No API key/);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.turn).not.toHaveBeenCalled();
    expect((await reloadStore()).resolveAgentKey()).toBeNull();
  });

  it("binds an explicit replacement to its new endpoint and sends only that key", async () => {
    configureOpenAI();
    const response = await config.POST(request("POST", { baseUrl: otherEndpoint, key: "synthetic-replacement" }));
    expect(response.status).toBe(200);
    expect(persisted().binding).toEqual({ provider: "openai", baseUrl: otherEndpoint });
    await models.GET(request());
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(String(url)).toBe(`${otherEndpoint}/models`);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-replacement");
    expect(init.redirect).toBe("error");
  });

  it("blocks model/chat calls through an already-cached client after configuration changes", async () => {
    configureOpenAI();
    const previous = client.getOpenAI();
    store.setBaseUrl(otherEndpoint);
    await expect(previous.models.list({ maxRetries: 0 })).rejects.toThrow();
    await expect(previous.chat.completions.create({ model: "fixture-model", messages: [] }, { maxRetries: 0 })).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("blocks a cached Anthropic client after its credential is removed", async () => {
    store.setRuntimeKey("sk-ant-api-synthetic");
    const previous = client.getAnthropic();
    store.setRuntimeKey(null);
    await expect(previous.messages.create({ model: "fixture-model", max_tokens: 1, messages: [] }, { maxRetries: 0 })).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("drops credentials when switching provider and never resurrects them by switching back", async () => {
    store.setOAuthCredential(oauth);
    expect((await config.POST(request("POST", { provider: "openai" }))).status).toBe(200);
    expect(store.resolveAgentKey()).toBeNull();
    expect(persisted().oauth).toBeUndefined();
    store.setProvider("anthropic");
    expect(store.resolveAgentKey()).toBeNull();
    await store.ensureFreshOAuth();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "openai", baseUrl: otherEndpoint },
    { provider: "openai", baseUrl: `${endpoint}/other` },
    { provider: "anthropic", baseUrl: endpoint },
    null,
  ])("refuses a mismatched/missing binding %j without using a fallback", async (binding) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-env-key");
    mocks.file = JSON.stringify({ key, provider: "openai", baseUrl: endpoint, binding });
    expect(store.resolveAgentKey()).toBeNull();
    expect(() => client.getOpenAI()).toThrow(/No API key/);
    await models.GET(request());
    expect((await chat.POST(request("POST", { messages: [{ role: "user", content: "hello" }] }))).status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.turn).not.toHaveBeenCalled();
    store.setRuntimeModel("another-model");
    expect((await reloadStore()).resolveAgentKey()).toBeNull();
  });

  it("keeps an invalid binding disabled across a settings save/restart", async () => {
    mocks.file = JSON.stringify({ key, provider: "openai", baseUrl: endpoint, binding: { provider: "openai", baseUrl: "invalid" } });
    expect(store.resolveAgentKey()).toBeNull();
    store.setRuntimeModel("fixture-model");
    expect(persisted().binding).toBeNull();
    expect((await reloadStore()).resolveAgentKey()).toBeNull();
  });

  it("does not use a credential through the other provider's client", () => {
    configureOpenAI();
    expect(() => client.getAnthropic()).toThrow(/No Anthropic API key/);
    store.setProvider("anthropic");
    store.setRuntimeKey("sk-ant-api-synthetic");
    expect(() => client.getOpenAI()).toThrow(/No API key/);
  });

  it("pins Anthropic requests to the binding and ignores an unrelated env auth token", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "synthetic-unrelated-token");
    store.setRuntimeKey("sk-ant-api-synthetic");
    await client.getAnthropic().models.list();
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/models");
    expect(new Headers(init.headers).get("x-api-key")).toBe("sk-ant-api-synthetic");
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect(init.redirect).toBe("error");
    vi.stubEnv("ANTHROPIC_BASE_URL", otherEndpoint);
    expect(() => client.getAnthropic()).toThrow(/No Anthropic API key/);
  });
});

describe("legacy keys and endpoint safety", () => {
  it.each(["anthropic", "openai"] as const)("migrates an existing %s key with its current canonical endpoint", async (provider) => {
    mocks.file = JSON.stringify({ key, provider, baseUrl: "https://MODELS.example.test:443/v1/" });
    const binding = { provider, baseUrl: provider === "openai" ? endpoint : "https://api.anthropic.com" };
    expect(store.resolveAgentKey()).toMatchObject({ key, source: "ui", ...binding });
    expect(persisted().binding).toEqual(binding);
    expect((await reloadStore()).resolveAgentKey()).toMatchObject(binding);
  });

  it("persists an env-derived legacy binding so a later env endpoint cannot rebind it", async () => {
    vi.stubEnv("SWITCHYARD_AGENT_PROVIDER", "openai");
    vi.stubEnv("SWITCHYARD_AGENT_BASE_URL", endpoint);
    mocks.file = JSON.stringify({ key });
    expect(store.resolveAgentKey()).toMatchObject({ provider: "openai", baseUrl: endpoint });
    vi.stubEnv("SWITCHYARD_AGENT_BASE_URL", otherEndpoint);
    expect((await reloadStore()).resolveAgentKey()).toBeNull();
  });

  it("does not invalidate the key for equivalent normalized endpoints or model-only changes", async () => {
    configureOpenAI();
    expect((await config.POST(request("POST", { baseUrl: "https://MODELS.example.test:443/v1///", model: "new-model" }))).status).toBe(200);
    expect(store.resolveAgentKey()?.key).toBe(key);
    expect(store.resolveBaseUrl()).toBe(endpoint);
    expect(store.resolveAgentModel()).toBe("new-model");
  });

  it.each(["http://remote.example.test/v1", "http://10.0.0.1/v1", "ftp://localhost/v1", "https://user:password@example.test/v1", "https://example.test/v1?key=fixture", "https://example.test/v1#fragment", "invalid"])("rejects unsafe endpoint %s without mutations", async (baseUrl) => {
    configureOpenAI();
    const before = mocks.file;
    expect((await config.POST(request("POST", { provider: "anthropic", baseUrl }))).status).toBe(400);
    expect(mocks.file).toBe(before);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:11434/v1", "http://127.0.0.1:11434/v1", "http://127.0.0.2:11434/v1", "http://[::1]:11434/v1", "https://models.example.test/v1"])("accepts supported endpoint %s", async (baseUrl) => {
    expect((await config.POST(request("POST", { provider: "openai", baseUrl, key }))).status).toBe(200);
    expect(store.resolveAgentKey()).toMatchObject({ provider: "openai", baseUrl });
  });

  it("refuses an unsafe legacy endpoint before any provider call", async () => {
    mocks.file = JSON.stringify({ key, provider: "openai", baseUrl: "http://remote.example.test/v1" });
    await models.GET(request());
    expect(store.resolveAgentKey()).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("OAuth credential binding", () => {
  it("refreshes a migrated Anthropic login with its original binding", async () => {
    mocks.file = JSON.stringify({ key: oauth.access, oauth: { refresh: oauth.refresh, expiresAt: 1 } });
    await store.ensureFreshOAuth();
    expect(mocks.refresh).toHaveBeenCalledWith(oauth.refresh);
    expect(store.resolveAgentKey()).toMatchObject({ key: "sk-ant-oat-refreshed", provider: "anthropic", baseUrl: "https://api.anthropic.com" });
  });

  it("never refreshes a login whose current endpoint differs from its binding", async () => {
    store.setOAuthCredential(oauth);
    vi.stubEnv("ANTHROPIC_BASE_URL", otherEndpoint);
    await store.ensureFreshOAuth();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(store.resolveAgentKey()).toBeNull();
  });

  it("does not restore an old credential when a refresh finishes after an endpoint change", async () => {
    store.setOAuthCredential(oauth);
    let finish!: (tokens: typeof oauth) => void;
    mocks.refresh.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const refreshing = store.ensureFreshOAuth();
    store.setProvider("openai");
    store.setBaseUrl(otherEndpoint);
    store.setRuntimeKey("synthetic-replacement");
    finish({ ...oauth, access: "sk-ant-oat-stale-result" });
    await refreshing;
    expect(store.resolveAgentKey()).toMatchObject({ key: "synthetic-replacement", provider: "openai", baseUrl: otherEndpoint });
    expect(persisted().oauth).toBeUndefined();
  });

  it("rejects an OAuth completion if the provider changed while code exchange was in flight", async () => {
    mocks.complete.mockImplementationOnce(async () => {
      configureOpenAI();
      return oauth;
    });
    expect((await oauthComplete.POST(request("POST", { code: "fixture-code" }))).status).toBe(400);
    expect(store.resolveAgentKey()?.key).toBe(key);
    expect(persisted().oauth).toBeUndefined();
  });
});
