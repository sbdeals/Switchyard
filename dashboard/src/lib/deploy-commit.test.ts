import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("next/server", () => ({ after: vi.fn(() => { throw new Error("No active request"); }) }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard-session",
  openSession: () => ({ dokployCookie: "dokploy-session=test" }),
}));
vi.mock("./git-remote", () => ({ resolveRepoCommit: vi.fn() }));
vi.mock("./docker", () => ({ inspectImageExposedPorts: vi.fn() }));
vi.mock("./repo-port", () => ({ fetchRepoExposedPorts: async () => [] }));

import { after } from "next/server";
import { repoDeploymentLabel } from "./deploy-commit";
import { composeAction, deployBridgeRepo } from "./dokploy";
import { inspectImageExposedPorts } from "./docker";
import { resolveRepoCommit } from "./git-remote";
import { imageStack, repoStack } from "./managed-compose";

const repoUrl = "https://github.com/acme/site";
const sha = "a1b2c3d" + "0".repeat(33);
const composeFile = repoStack({ appName: "site-test", repoUrl, branch: "main" });
const host = "site-test.203.0.113.10.traefik.me";
let detail: {
  appName: string;
  composeFile: string;
  env: string;
  composeStatus: string;
  deployments: { deploymentId: string; status: string }[];
  domains: { domainId: string; serviceName: string; host: string; port: number }[];
};
let requests: { procedure: string; body: Record<string, unknown> }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SWITCHYARD_HOST_IP", "");
  detail = { appName: "site-test", composeFile, env: "", composeStatus: "idle", deployments: [], domains: [] };
  requests = [];
  vi.mocked(resolveRepoCommit).mockResolvedValue({ sha, headline: "Fix header" });
  vi.mocked(inspectImageExposedPorts).mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const procedure = new URL(url).pathname.replace("/api/", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ procedure, body });
    switch (procedure) {
      case "compose.one": return Response.json(detail);
      case "compose.create": return Response.json({ composeId: "compose-1", appName: detail.appName });
      case "compose.update":
        if (typeof body.composeFile === "string") detail.composeFile = body.composeFile;
        return Response.json({});
      case "domain.generateDomain": return Response.json(host);
      case "domain.create":
        detail.domains.push({ domainId: "domain-1", ...body });
        return Response.json({});
      case "domain.update":
        detail.domains = detail.domains.map((domain) => ({ ...domain, ...body }));
        return Response.json({});
      case "compose.deploy":
        detail.composeStatus = "running";
        detail.deployments.push({ deploymentId: `deploy-${detail.deployments.length + 1}`, status: "running" });
        return Response.json({});
      case "compose.stop": return Response.json({});
      default: throw new Error(`Unexpected procedure: ${procedure}`);
    }
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const deployments = () => requests.filter(({ procedure }) => procedure === "compose.deploy");

describe("repoDeploymentLabel", () => {
  it("uses a short SHA and headline in the title and preserves full attribution in the description", async () => {
    expect(await repoDeploymentLabel(composeFile)).toEqual({
      title: "Deploy a1b2c3d · Fix header",
      description: `Branch main at deploy request: ${sha}\nFix header`,
    });
    expect(resolveRepoCommit).toHaveBeenCalledExactlyOnceWith(repoUrl, "main");
  });

  it("uses a SHA-only label when a headline is unavailable", async () => {
    vi.mocked(resolveRepoCommit).mockResolvedValue({ sha });
    expect(await repoDeploymentLabel(composeFile)).toEqual({
      title: "Deploy a1b2c3d", description: `Branch main at deploy request: ${sha}`,
    });
  });

  it.each([undefined, null, "services: {}", imageStack({ appName: "site-test", image: "nginx:alpine" })])(
    "leaves non-repo services unchanged (%#)", async (file) => {
      expect(await repoDeploymentLabel(file)).toEqual({});
      expect(resolveRepoCommit).not.toHaveBeenCalled();
    },
  );

  it.each(["unavailable", "error"])("omits optional metadata when the lookup returns %s", async (result) => {
    if (result === "error") vi.mocked(resolveRepoCommit).mockRejectedValueOnce(new Error("network"));
    else vi.mocked(resolveRepoCommit).mockResolvedValueOnce(null);
    expect(await repoDeploymentLabel(composeFile)).toEqual({});
  });
});

describe("bridge repo deployment titles", () => {
  it("sends the SHA and headline on the initial managed repo deploy", async () => {
    expect(await deployBridgeRepo("site", { repoUrl, branch: "main" }, "environment-1")).toBe("compose-1");
    expect(deployments()).toEqual([{
      procedure: "compose.deploy",
      body: { composeId: "compose-1", title: "Deploy a1b2c3d · Fix header", description: `Branch main at deploy request: ${sha}\nFix header` },
    }]);
  });

  it("resolves the branch again on each redeploy", async () => {
    await composeAction("compose-1", "deploy");
    const nextSha = "f".repeat(40);
    vi.mocked(resolveRepoCommit).mockResolvedValueOnce({ sha: nextSha, headline: "Fix footer" });
    await composeAction("compose-1", "deploy");
    expect(deployments().map(({ body }) => body.title)).toEqual([
      "Deploy a1b2c3d · Fix header", "Deploy fffffff · Fix footer",
    ]);
    expect(resolveRepoCommit).toHaveBeenCalledTimes(2);
  });

  it("also labels the automatic redeploy that applies a detected image port", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SWITCHYARD_HOST_IP", "203.0.113.10");
    vi.stubEnv("BRIDGE_REPO_PORT_POLL_MS", "10");
    vi.stubEnv("BRIDGE_REPO_PORT_TIMEOUT_MS", "100");
    let background: (() => Promise<void>) | undefined;
    vi.mocked(after).mockImplementationOnce((task) => { background = task as () => Promise<void>; });
    await deployBridgeRepo("site", { repoUrl, branch: "main" }, "environment-1");
    detail.composeStatus = "done";
    detail.deployments[0].status = "done";
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["80/tcp"]);
    const nextSha = "f".repeat(40);
    vi.mocked(resolveRepoCommit).mockResolvedValueOnce({ sha: nextSha, headline: "Update page" });
    if (!background) throw new Error("Expected a port watcher");
    const pending = background();
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(deployments().map(({ body }) => body.title)).toEqual([
      "Deploy a1b2c3d · Fix header", "Deploy fffffff · Update page",
    ]);
    expect(detail.domains[0].port).toBe(80);
  });

  it("sends a SHA-only title when the GitHub headline is unavailable", async () => {
    vi.mocked(resolveRepoCommit).mockResolvedValueOnce({ sha });
    await composeAction("compose-1", "deploy");
    expect(deployments()[0].body).toEqual({
      composeId: "compose-1", title: "Deploy a1b2c3d", description: `Branch main at deploy request: ${sha}`,
    });
  });

  it.each(["unavailable", "error"])("still deploys when commit metadata is %s", async (result) => {
    if (result === "error") vi.mocked(resolveRepoCommit).mockRejectedValueOnce(new Error("network"));
    else vi.mocked(resolveRepoCommit).mockResolvedValueOnce(null);
    await expect(composeAction("compose-1", "deploy")).resolves.toBeUndefined();
    expect(deployments()).toEqual([{ procedure: "compose.deploy", body: { composeId: "compose-1" } }]);
  });

  it.each(["services: {}", imageStack({ appName: "site-test", image: "nginx:alpine" })])(
    "preserves ordinary compose and image deploy requests (%#)", async (file) => {
      detail.composeFile = file;
      await composeAction("compose-1", "deploy");
      expect(deployments()[0].body).toEqual({ composeId: "compose-1" });
      expect(resolveRepoCommit).not.toHaveBeenCalled();
    },
  );

  it("does not look up commit metadata for other lifecycle actions", async () => {
    await composeAction("compose-1", "stop");
    expect(resolveRepoCommit).not.toHaveBeenCalled();
    expect(requests).toEqual([{ procedure: "compose.stop", body: { composeId: "compose-1" } }]);
  });
});
