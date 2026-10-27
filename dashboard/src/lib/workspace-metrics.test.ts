import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: "alice",
  runtime: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }) }) }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-session",
  openSession: (value: string) => ({ dokployCookie: value }),
}));
vi.mock("./docker", () => ({
  listRuntimeStates: mocks.runtime,
  deriveComposeRuntime: () => ({ health: "not-running", running: 0, total: 0 }),
  deriveSwarmRuntime: vi.fn(),
}));

import { loadWorkspace } from "./dokploy";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookie = "alice";
  mocks.runtime.mockResolvedValue({ compose: new Map(), swarm: new Map() });
  mocks.fetch.mockImplementation(async (url: string, options: RequestInit) => {
    const user = (options.headers as Record<string, string>).Cookie;
    if (url.endsWith("project.all")) {
      return Response.json([{
        projectId: `${user}-project`, name: user,
        environments: [{ environmentId: `${user}-env`, name: "test", compose: [{ composeId: `${user}-compose` }] }],
      }]);
    }
    if (url.includes(`compose.one?composeId=${user}-compose`)) {
      return Response.json({ name: `${user} service`, appName: `${user}-app` });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => vi.unstubAllGlobals());

describe("workspace ownership for metrics", () => {
  it("reads project.all with each current user's session and can skip Docker entirely", async () => {
    const alice = await loadWorkspace({ includeRuntime: false });
    mocks.cookie = "bob";
    const bob = await loadWorkspace({ includeRuntime: false });
    expect(alice.services.map((service) => service.appName)).toEqual(["alice-app"]);
    expect(bob.services.map((service) => service.appName)).toEqual(["bob-app"]);
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("project.all"))).toHaveLength(2);
  });

  it("retains the existing runtime enrichment by default", async () => {
    const workspace = await loadWorkspace();
    expect(mocks.runtime).toHaveBeenCalledTimes(1);
    expect(workspace.services[0].runtime).toEqual({ health: "not-running", running: 0, total: 0 });
  });
});
