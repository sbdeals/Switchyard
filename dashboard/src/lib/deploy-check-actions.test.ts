import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { load } from "js-yaml";
import { saveDeployChecks } from "./dokploy";

const mocks = vi.hoisted(() => ({
  getCookie: vi.fn(),
  openSession: vi.fn(),
  redirect: vi.fn(),
  isSwarmManager: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.getCookie }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./session", () => ({ SESSION_COOKIE: "switchyard_session", openSession: mocks.openSession }));
vi.mock("./docker", () => ({
  isSwarmManager: mocks.isSwarmManager,
  deriveComposeRuntime: vi.fn(),
  deriveSwarmRuntime: vi.fn(),
  listRuntimeStates: vi.fn(),
  readDeployCheckContainers: vi.fn(),
}));

const input = {
  healthcheckPath: "/ready",
  healthcheckTimeout: 30,
  healthcheckPort: 80,
  preDeployCommand: "",
};
const compose = {
  sourceType: "raw",
  composeType: "docker-compose",
  serverId: null,
  appName: "hc-actions",
  command: null,
  composeFile: "services:\n  web:\n    image: nginx:alpine\n",
};

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const mutations = () => mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.getCookie.mockReturnValue({ value: "sealed-test-session" });
  mocks.openSession.mockReturnValue({ dokployCookie: "session=test-user", email: "test@example.invalid", iat: 0 });
  mocks.redirect.mockImplementation(() => { throw new Error("redirect:/login"); });
  mocks.isSwarmManager.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveDeployChecks authorization and writes", () => {
  it("forwards the current user's cookie on both reads and updates", async () => {
    mocks.fetch.mockImplementation(async (url) => {
      if (String(url).includes("/api/application.one?")) return json({ serverId: null, healthCheckSwarm: null });
      if (String(url).endsWith("/api/application.update")) return json(null);
      throw new Error("Unexpected API call");
    });
    for (const user of ["first", "second"]) {
      const callsBefore = mocks.fetch.mock.calls.length;
      mocks.openSession.mockReturnValue({ dokployCookie: `session=${user}`, email: `${user}@example.invalid`, iat: 0 });

      await saveDeployChecks("application", "app/id", input);

      for (const [, init] of mocks.fetch.mock.calls.slice(callsBefore)) {
        expect(init?.headers).toMatchObject({ Cookie: `session=${user}` });
      }
    }
    expect(mocks.getCookie).toHaveBeenCalledWith("switchyard_session");
    expect(mocks.openSession).toHaveBeenCalledWith("sealed-test-session");
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("application.one?applicationId=app%2Fid");
    expect(mutations()).toHaveLength(2);
    expect(JSON.parse(mutations()[0][1]?.body as string)).toMatchObject({
      applicationId: "app/id",
      healthCheckSwarm: { Test: ["CMD-SHELL", expect.stringContaining("http://127.0.0.1:80/ready")] },
    });
  });

  it("rejects an invalid dashboard session before any API call", async () => {
    mocks.openSession.mockReturnValue(null);

    await expect(saveDeployChecks("compose", "compose-id", input)).rejects.toThrow("redirect:/login");

    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.isSwarmManager).not.toHaveBeenCalled();
  });

  it("rejects an expired Dokploy cookie before mutation without signing in", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(saveDeployChecks("application", "app-id", input)).rejects.toThrow("redirect:/login");

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mutations()).toHaveLength(0);
    expect(mocks.isSwarmManager).not.toHaveBeenCalled();
  });

  it("rejects an invalid service kind before any API call", async () => {
    await expect(saveDeployChecks("database" as "application", "id", input)).rejects.toThrow("only support applications and Compose");

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { manager: false, serverId: null },
    { manager: true, serverId: "remote-id" },
  ])("rejects unsupported application hosts: $manager / $serverId", async ({ manager, serverId }) => {
    mocks.isSwarmManager.mockResolvedValue(manager);
    mocks.fetch.mockResolvedValueOnce(json({ serverId, healthCheckSwarm: null }));

    await expect(saveDeployChecks("application", "app-id", input)).rejects.toThrow("Not supported on this host");

    expect(mutations()).toHaveLength(0);
  });

  it("rejects application pre-deploy commands even on a Swarm manager", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ serverId: null, healthCheckSwarm: null }));

    await expect(saveDeployChecks("application", "app-id", { ...input, preDeployCommand: "npm run migrate" })).rejects.toThrow("pre-deploy commands are not supported");

    expect(mutations()).toHaveLength(0);
  });

  it("preserves an application's custom existing healthcheck", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ serverId: null, healthCheckSwarm: { Test: ["CMD", "custom-check"] } }));

    await expect(saveDeployChecks("application", "app-id", input)).rejects.toThrow("custom Swarm healthcheck");

    expect(mutations()).toHaveLength(0);
  });

  it.each([
    { sourceType: "git", serverId: null, composeType: "docker-compose" },
    { sourceType: "raw", serverId: "remote-id", composeType: "docker-compose" },
    { sourceType: "raw", serverId: null, composeType: "stack" },
  ])("rejects unsupported Compose targets: $sourceType / $serverId / $composeType", async (target) => {
    mocks.fetch.mockResolvedValueOnce(json({ ...compose, ...target }));

    await expect(saveDeployChecks("compose", "compose-id", input)).rejects.toThrow(/require/);

    expect(mutations()).toHaveLength(0);
  });

  it("saves Compose YAML and the wait command together in one update", async () => {
    mocks.fetch.mockResolvedValueOnce(json(compose)).mockResolvedValueOnce(json(null));

    await saveDeployChecks("compose", "compose-id", { ...input, serviceName: "web", preDeployCommand: "npm run migrate" });

    expect(mutations()).toHaveLength(1);
    const [url, init] = mutations()[0];
    expect(String(url)).toMatch(/\/api\/compose\.update$/);
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({ composeId: "compose-id", command: expect.stringContaining("--wait --wait-timeout 30") });
    expect(load(body.composeFile)).toMatchObject({
      services: {
        web: {
          image: "nginx:alpine",
          healthcheck: { test: ["CMD-SHELL", expect.stringContaining("http://127.0.0.1:80/ready")] },
          depends_on: { "sy-predeploy": { condition: "service_completed_successfully" } },
        },
        "sy-predeploy": { image: "nginx:alpine", command: ["npm run migrate"], restart: "no" },
      },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["application", "compose"] as const)("does not update %s when validation fails", async (kind) => {
    mocks.fetch.mockResolvedValueOnce(json(kind === "compose" ? compose : { serverId: null, healthCheckSwarm: null }));

    await expect(saveDeployChecks(kind, "id", { ...input, healthcheckTimeout: 0 })).rejects.toThrow("between 5 and 600");

    expect(mutations()).toHaveLength(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
