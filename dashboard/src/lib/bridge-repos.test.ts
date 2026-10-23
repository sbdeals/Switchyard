import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard-session",
  openSession: () => ({ dokployCookie: "dokploy-session=test" }),
}));
vi.mock("./docker", () => ({ inspectImageExposedPorts: vi.fn() }));
vi.mock("./repo-port", () => ({ fetchRepoExposedPorts: async () => [] }));

import {
  composeLifecycleAction,
  createComposeDomainAction,
  deleteDomainAction,
  quickDeployGithubAction,
  quickDeployRepoAction,
  saveComposeEnvAction,
  updateDomainAction,
} from "@/app/actions";
import { inspectImageExposedPorts } from "./docker";
import { ensureBridgeAutoDomain } from "./dokploy";
import { parseManaged, repoStack } from "./managed-compose";

const appName = "welcome-a1b2";
const repoUrl = "https://github.com/docker/welcome-to-docker";
const host = `${appName}-c3d4.203.0.113.10.traefik.me`;
const githubInput = { githubId: "github-1", owner: "docker", repository: "welcome-to-docker", branch: "main" };
let detail: {
  appName: string;
  composeFile: string;
  env: string;
  domains: { domainId: string; host: string; serviceName: string }[];
};
let requests: { procedure: string; body: Record<string, unknown> }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SWITCHYARD_DEPLOY_TARGET", "bridge");
  vi.stubEnv("SWITCHYARD_HOST_IP", "203.0.113.10");
  vi.mocked(inspectImageExposedPorts).mockResolvedValue([]);
  detail = { appName, composeFile: repoStack({ appName, repoUrl, branch: "main" }), env: "", domains: [] };
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const procedure = new URL(url).pathname.replace("/api/", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ procedure, body });
    switch (procedure) {
      case "compose.create": return Response.json({ composeId: "compose-1", appName });
      case "compose.one": return Response.json(detail);
      case "compose.update":
        if (typeof body.composeFile === "string") detail.composeFile = body.composeFile;
        return Response.json({});
      case "compose.saveEnvironment":
        detail.env = body.env;
        return Response.json({});
      case "application.create": return Response.json({ applicationId: "application-1" });
      case "application.one": return Response.json({ appName, domains: [], env: "" });
      case "domain.generateDomain": return Response.json(host);
      case "domain.create":
      case "domain.update":
      case "domain.delete":
      case "compose.deploy":
      case "application.saveGitProvider":
      case "application.saveGithubProvider":
      case "application.update":
      case "application.deploy": return Response.json({});
      default: throw new Error(`Unexpected request: ${procedure}`);
    }
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("bridge Git quick deploy", () => {
  it("creates a managed repo stack and attaches its public URL before deploying", async () => {
    expect(await quickDeployRepoAction(repoUrl, "main", "environment-1"))
      .toEqual({ ok: true, id: "compose-1" });
    expect(requests.find(({ procedure }) => procedure === "compose.create")?.body)
      .toMatchObject({ environmentId: "environment-1" });
    expect(requests.find(({ procedure }) => procedure === "compose.update")?.body)
      .toMatchObject({ composeId: "compose-1", sourceType: "raw", composeType: "docker-compose", isolatedDeployment: false });
    expect(parseManaged(detail.composeFile)).toMatchObject({
      kind: "repo", image: `${appName}-app:latest`, repoUrl, branch: "main",
    });
    expect(requests.find(({ procedure }) => procedure === "domain.create")?.body).toMatchObject({
      composeId: "compose-1", serviceName: "app", domainType: "compose", host, port: 3000,
      https: false, certificateType: "none",
    });
    expect(requests.findIndex(({ procedure }) => procedure === "domain.create"))
      .toBeLessThan(requests.findIndex(({ procedure }) => procedure === "compose.deploy"));
    expect(requests.some(({ procedure }) => procedure.startsWith("application."))).toBe(false);
  });

  it("passes a subdirectory and Dockerfile through to the managed repo", async () => {
    expect(await quickDeployRepoAction(repoUrl, "release", "environment-1", {
      subdirectory: "apps/web", dockerfile: "docker/Dockerfile.prod",
    })).toEqual({ ok: true, id: "compose-1" });
    expect(parseManaged(detail.composeFile)).toMatchObject({
      branch: "release", subdirectory: "apps/web", dockerfile: "docker/Dockerfile.prod",
    });
    expect(detail.composeFile).toContain(`${repoUrl}.git#release:apps/web`);
  });

  it.each([
    ["ssh://github.com/docker/welcome-to-docker", "main", undefined],
    ["https://user:token@github.com/docker/welcome-to-docker", "main", undefined],
    ["https://github.com/docker/welcome to docker", "main", undefined],
    [repoUrl, "main#other", undefined],
    [repoUrl, "main", { subdirectory: "../web" }],
  ])("rejects invalid Git input before creating a project or service (%s, %s)", async (url, branch, options) => {
    const result = await quickDeployRepoAction(url, branch, undefined, options);
    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    expect(requests).toEqual([]);
  });

  it("returns actionable GitHub App errors before resolving an environment or creating anything", async () => {
    expect(await quickDeployGithubAction(githubInput)).toEqual({
      ok: false,
      error: "GitHub App deploys need Swarm. On this host, deploy a public repo URL with a Dockerfile, or push an image to a registry and deploy the image.",
    });
    expect(requests).toEqual([]);
  });

  it("still deploys when the host has no automatic public URL", async () => {
    vi.stubEnv("SWITCHYARD_HOST_IP", "");
    expect(await quickDeployRepoAction(repoUrl, "main", "environment-1"))
      .toEqual({ ok: true, id: "compose-1" });
    expect(requests.some(({ procedure }) => procedure.startsWith("domain."))).toBe(false);
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });
});

describe("managed repo port and Networking", () => {
  it.each([
    ["PORT=8080", ["80/tcp"], 8080],
    ["", ["9000/tcp", "8080/tcp", "53/udp"], 8080],
    ["", [], 3000],
  ])("resolves the repo port from variables and the locally built image", async (env, exposedPorts, port) => {
    detail.env = env;
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(exposedPorts);
    expect(await ensureBridgeAutoDomain("compose-1")).toBe(host);
    expect(inspectImageExposedPorts).toHaveBeenCalledWith(`${appName}-app:latest`);
    expect(requests.find(({ procedure }) => procedure === "domain.create")?.body.port).toBe(port);
  });

  it("keeps an existing app auto-domain without duplicating it", async () => {
    detail.domains = [{ domainId: "domain-1", host, serviceName: "app" }];
    expect(await ensureBridgeAutoDomain("compose-1")).toBe(host);
    expect(requests.some(({ procedure }) => procedure.startsWith("domain."))).toBe(false);
  });

  it("uses the built image port for custom domains and deploys the labels", async () => {
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["8080/tcp"]);
    expect(await createComposeDomainAction("compose-1", "app", "web.example.com"))
      .toEqual({ ok: true });
    expect(requests.find(({ procedure }) => procedure === "domain.create")?.body.port).toBe(8080);
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });

  it("redeploys repo stacks after editing or deleting domains", async () => {
    expect(await updateDomainAction("domain-1", {
      host: "web.example.com", port: 8080, https: false, certificateType: "none",
    }, "compose-1")).toEqual({ ok: true });
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
    requests = [];
    expect(await deleteDomainAction("domain-1", "compose-1")).toEqual({ ok: true });
    expect(requests[0]).toEqual({ procedure: "domain.delete", body: { domainId: "domain-1" } });
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });
});

it("saves repo variables and redeploys through compose while preserving the Git build", async () => {
  const composeFile = detail.composeFile;
  expect(await saveComposeEnvAction("compose-1", "PORT=8080\nMESSAGE=hello"))
    .toEqual({ ok: true });
  expect(requests[0]).toEqual({
    procedure: "compose.saveEnvironment", body: { composeId: "compose-1", env: "PORT=8080\nMESSAGE=hello" },
  });
  expect(await composeLifecycleAction("compose-1", "deploy")).toEqual({ ok: true });
  expect(requests.at(-1)).toEqual({ procedure: "compose.deploy", body: { composeId: "compose-1" } });
  expect(detail.composeFile).toBe(composeFile);
});

describe("Swarm Git quick deploy", () => {
  beforeEach(() => vi.stubEnv("SWITCHYARD_DEPLOY_TARGET", "swarm"));

  it("keeps public Git deploys on native applications", async () => {
    expect(await quickDeployRepoAction(repoUrl, "release", "environment-1"))
      .toEqual({ ok: true, id: "application-1" });
    expect(requests.find(({ procedure }) => procedure === "application.saveGitProvider")?.body)
      .toEqual({ applicationId: "application-1", customGitUrl: repoUrl, customGitBranch: "release", customGitBuildPath: "/", watchPaths: [] });
    expect(requests.some(({ procedure }) => procedure === "application.deploy")).toBe(true);
    expect(requests.some(({ procedure }) => procedure.startsWith("compose."))).toBe(false);
  });

  it("keeps GitHub App deploys and push auto-deploy on native applications", async () => {
    expect(await quickDeployGithubAction({ ...githubInput, environmentId: "environment-1" }))
      .toEqual({ ok: true, id: "application-1" });
    expect(requests.find(({ procedure }) => procedure === "application.saveGithubProvider")?.body)
      .toMatchObject({ applicationId: "application-1", ...githubInput, triggerType: "push" });
    expect(requests.find(({ procedure }) => procedure === "application.update")?.body)
      .toEqual({ applicationId: "application-1", autoDeploy: true });
    expect(requests.some(({ procedure }) => procedure === "application.deploy")).toBe(true);
    expect(requests.some(({ procedure }) => procedure.startsWith("compose."))).toBe(false);
  });
});
