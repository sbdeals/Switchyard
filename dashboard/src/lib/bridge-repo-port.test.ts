import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const background = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => background.push(fn) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard-session",
  openSession: () => ({ dokployCookie: "dokploy-session=test" }),
}));
vi.mock("./docker", () => ({ inspectImageExposedPorts: vi.fn() }));

import { composeAction, deployBridgeRepo, saveServiceEnv } from "./dokploy";
import { inspectImageExposedPorts } from "./docker";
import { parseManaged } from "./managed-compose";
import { saveComposeFileAction, updateDomainAction } from "@/app/actions";

const host = "repo-test.203.0.113.10.traefik.me";
const source = { repoUrl: "http://192.0.2.10:8081/test.git", branch: "main" };
let detail: {
  appName: string;
  composeFile: string;
  composeStatus: string;
  env: string;
  deployments: { deploymentId: string; status: string }[];
  domains: { domainId: string; host: string; port: number; serviceName: string }[];
};
let requests: { procedure: string; body: Record<string, unknown> }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("SWITCHYARD_HOST_IP", "203.0.113.10");
  vi.stubEnv("BRIDGE_REPO_PORT_POLL_MS", "10");
  vi.stubEnv("BRIDGE_REPO_PORT_TIMEOUT_MS", "100");
  background.length = 0;
  detail = { appName: "repo-test", composeFile: "", composeStatus: "idle", env: "", deployments: [], domains: [] };
  requests = [];
  vi.mocked(inspectImageExposedPorts).mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (new URL(url).hostname === "raw.githubusercontent.com") return new Response("FROM alpine\nEXPOSE 80/tcp");
    const procedure = new URL(url).pathname.replace("/api/", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ procedure, body });
    switch (procedure) {
      case "compose.create": return Response.json({ composeId: "compose-1", appName: detail.appName });
      case "compose.one": return Response.json(detail);
      case "compose.update":
        if (body.composeFile) detail.composeFile = body.composeFile;
        return Response.json({});
      case "compose.saveEnvironment":
        detail.env = body.env;
        return Response.json({});
      case "compose.stop": return Response.json({});
      case "domain.generateDomain": return Response.json(host);
      case "domain.create":
        detail.domains.push({ domainId: "domain-1", ...body });
        return Response.json({});
      case "domain.update":
        detail.domains = detail.domains.map((domain) => ({ ...domain, ...body }));
        return Response.json({});
      case "compose.deploy":
        detail.deployments.push({ deploymentId: `deploy-${detail.deployments.length + 1}`, status: "running" });
        detail.composeStatus = "running";
        return Response.json({});
      default: throw new Error(`Unexpected procedure: ${procedure}`);
    }
  }));
});

afterEach(async () => {
  // Drain callbacks that a test did not run, including their bounded timers.
  const pending = background.map((fn) => fn());
  await vi.runAllTimersAsync();
  await Promise.all(pending);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const deployments = () => requests.filter(({ procedure }) => procedure === "compose.deploy");
const updates = () => requests.filter(({ procedure }) => procedure === "domain.update");
function finishBuild() {
  detail.composeStatus = "done";
  detail.deployments[0].status = "done";
  vi.mocked(inspectImageExposedPorts).mockResolvedValue(["80/tcp"]);
}
async function runWatcher() {
  const pending = background[0]();
  await vi.advanceTimersByTimeAsync(10);
  await pending;
}

describe("first repo deployment port", () => {
  it("uses the public Dockerfile's port 80 on the first deploy and needs no follow-up", async () => {
    await deployBridgeRepo("repo", { ...source, repoUrl: "https://github.com/example/repo" }, "env-1");
    expect(detail.domains[0].port).toBe(80);
    expect(deployments()).toHaveLength(1);
    finishBuild();
    await runWatcher();
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it("automatically corrects a local HTTP repo to port 80 with one follow-up and no user action", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    expect(detail.domains[0].port).toBe(3000);
    expect(background).toHaveLength(1);
    finishBuild();
    await runWatcher();
    expect(detail.domains[0].port).toBe(80);
    expect(updates()).toHaveLength(1);
    expect(deployments()).toHaveLength(2);
    expect(parseManaged(detail.composeFile)).toMatchObject({ autoDomain: { host, port: 80 } });
    await background[0](); // duplicate callback cannot submit another deployment
    await composeAction("compose-1", "deploy");
    expect(updates()).toHaveLength(1);
    expect(deployments()).toHaveLength(3); // only the explicit user request
  });

  it("still deploys and repairs the port when fetching the public Dockerfile fails", async () => {
    const fetchApi = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).includes("raw.githubusercontent.com")
        ? Promise.reject(new Error("Unavailable")) : fetchApi(input, init));
    await deployBridgeRepo("repo", { ...source, repoUrl: "https://github.com/example/repo" }, "env-1");
    expect(deployments()).toHaveLength(1);
    finishBuild();
    await runWatcher();
    expect(detail.domains[0].port).toBe(80);
    expect(deployments()).toHaveLength(2);
  });

  it("preserves a Networking edit, including explicitly selecting fallback port 3000", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    expect(await updateDomainAction("domain-1", { host, port: 3000, https: false, certificateType: "none" }, "compose-1"))
      .toEqual({ ok: true });
    await runWatcher();
    expect(detail.domains[0].port).toBe(3000);
    expect(deployments()).toHaveLength(2); // initial + Networking edit
    expect(updates()).toHaveLength(1); // explicit edit only
  });

  it("leaves a port edited directly in Dokploy alone", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    detail.domains[0].port = 9090;
    await runWatcher();
    expect(detail.domains[0].port).toBe(9090);
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it("rechecks a direct Dokploy edit made while local image inspection is pending", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    let inspected!: (ports: string[]) => void;
    vi.mocked(inspectImageExposedPorts).mockImplementationOnce(() => new Promise((resolve) => { inspected = resolve; }));
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    detail.domains[0].port = 9090;
    inspected(["80/tcp"]);
    await pending;
    expect(detail.domains[0].port).toBe(9090);
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it.each(["deploy", "stop", "Networking", "Compose file", "PORT"])("cancels in-flight detection before an explicit %s change", async (action) => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    let inspected!: (ports: string[]) => void;
    vi.mocked(inspectImageExposedPorts).mockImplementationOnce(() => new Promise((resolve) => { inspected = resolve; }));
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    const file = detail.composeFile + "# user edit\n";
    const explicit = action === "deploy" ? composeAction("compose-1", "deploy")
      : action === "stop" ? composeAction("compose-1", "stop")
        : action === "PORT" ? saveServiceEnv({ kind: "compose", id: "compose-1" }, "PORT=3000")
      : action === "Networking" ? updateDomainAction("domain-1", { host, port: 9090, https: false, certificateType: "none" }, "compose-1")
        : saveComposeFileAction("compose-1", file);
    await vi.advanceTimersByTimeAsync(0);
    inspected(["80/tcp"]);
    await Promise.all([pending, explicit]);
    const redeploys = action === "deploy" || action === "Networking";
    expect(updates()).toHaveLength(redeploys ? 1 : 0);
    expect(deployments()).toHaveLength(redeploys ? 2 : 1);
    if (action === "Networking") expect(detail.domains[0].port).toBe(9090);
    if (action === "Compose file") expect(detail.composeFile).toBe(file);
    if (action === "PORT") expect(detail.env).toBe("PORT=3000");
  });

  it("applies a correction accepted before the deadline even if the writes cross it", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    const fetchApi = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/domain.update")) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return fetchApi(input, init);
    });
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(detail.domains[0].port).toBe(80);
    expect(deployments()).toHaveLength(2);
  });

  it.each(["error", "another deployment", "changed deployment"])("does not follow up after %s", async (state) => {
    await deployBridgeRepo("repo", source, "env-1");
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10); // capture first deployment identity while running
    finishBuild();
    if (state === "error") detail.deployments[0].status = "error";
    if (state === "another deployment") detail.deployments.push({ deploymentId: "external", status: "done" });
    if (state === "changed deployment") detail.deployments[0].deploymentId = "external";
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it("expires without acting on a stale done compose status or missing deployment record", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    detail.deployments = [];
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it("does not throw or mutate when background authorization expires", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    vi.mocked(fetch).mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await runWatcher();
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("compose.one?composeId=compose-1"),
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: "dokploy-session=test" }) }));
  });
});
