import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: "", fetch: vi.fn(), runExec: vi.fn(), readRecentLogs: vi.fn(), sampleStatsOnce: vi.fn(), listRuntimeStates: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }) }) }));
vi.mock("./docker", () => mocks);

import { sealSession, SESSION_MAX_AGE } from "./session";
import { runTool } from "./agent/tools";

function login(user: string, iat = Date.now()) {
  mocks.cookie = sealSession({ dokployCookie: `dokploy=${user}`, email: `${user}@example.test`, iat });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "agent-tools-test-secret");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    const user = new Headers(init.headers).get("cookie")!.slice(8);
    if (url.endsWith("/api/project.all")) return Response.json([{ projectId: user, name: user,
      environments: [{ environmentId: user, name: user, applications: [{ applicationId: `${user}-id` }] }] }]);
    expect(url).toContain(`application.one?applicationId=${user}-id`);
    return Response.json({ name: user, appName: `${user}-app` });
  });
  mocks.runExec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0, truncated: false });
  mocks.readRecentLogs.mockResolvedValue([]);
  mocks.sampleStatsOnce.mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe.each(["exec_in_service", "read_recent_logs", "get_metrics"])("agent %s ownership", (tool) => {
  const invoke = () => runTool(tool, { service: "alice-app", command: "echo test" }, { sessionKey: "test-hash" });

  it.each(["forged", "expired", "other user", "revoked", "unavailable"])("denies %s after an owner warms the tool", async (failure) => {
    login("alice");
    expect((await invoke()).isError).not.toBe(true);
    expect([mocks.runExec, mocks.readRecentLogs, mocks.sampleStatsOnce].some((fn) => fn.mock.calls.length)).toBe(true);
    vi.clearAllMocks();
    if (failure === "forged") mocks.cookie = "x";
    else if (failure === "expired") login("alice", Date.now() - SESSION_MAX_AGE * 1000);
    else if (failure === "other user") login("bob");
    else if (failure === "revoked") mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }));
    else mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    expect((await invoke()).isError).toBe(true);
    expect(mocks.runExec).not.toHaveBeenCalled();
    expect(mocks.readRecentLogs).not.toHaveBeenCalled();
    expect(mocks.sampleStatsOnce).not.toHaveBeenCalled();
    expect(mocks.listRuntimeStates).not.toHaveBeenCalled();
    if (failure === "forged" || failure === "expired") expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
