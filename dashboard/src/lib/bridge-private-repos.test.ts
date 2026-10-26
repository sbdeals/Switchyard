import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("./session", () => ({ SESSION_COOKIE: "switchyard-session", openSession: () => ({ dokployCookie: "dokploy-session=current-user" }) }));
vi.mock("./docker", () => ({ inspectImageExposedPorts: vi.fn(async () => []) }));
vi.mock("./repo-port", async (importOriginal) => ({ ...await importOriginal<typeof import("./repo-port")>(), fetchRepoBuildFiles: vi.fn(), fetchRepoExposedPorts: vi.fn() }));
vi.mock("./private-repo-files", () => ({ readPrivateRepoFiles: vi.fn() }));

import { gitBranchesAction, gitConnectionsAction, gitRepositoriesAction, quickDeployConnectedGitAction, quickDeployGithubAction } from "@/app/actions";
import { updateComposeFile, composeAction } from "./dokploy";
import { fetchRepoBuildFiles, fetchRepoExposedPorts } from "./repo-port";
import { parseManaged } from "./managed-compose";
import { readPrivateRepoFiles } from "./private-repo-files";
import type { GitProviderKind, PrivateRepoInput } from "./private-repo";

const sentinel = "TEST_CREDENTIAL_MUST_NOT_LEAVE_PROVIDER";
const appName = "private-web-abc";
const host = "private-web.203.0.113.10.traefik.me";
const input: PrivateRepoInput & { environmentId: string } = {
  providerKind: "github", providerId: "github-1", repository: "team/web", branch: "main", port: 8080, environmentId: "env-1",
};
let detail: Record<string, unknown>;
let requests: { procedure: string; body: Record<string, unknown>; query: URLSearchParams; cookie: string | null }[];
let patches: Record<string, string>;
let denied: string;
let failure: string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SWITCHYARD_DEPLOY_TARGET", "bridge");
  vi.stubEnv("SWITCHYARD_HOST_IP", "203.0.113.10");
  detail = { appName, composeFile: "", env: "", domains: [] };
  requests = []; patches = {}; denied = ""; failure = "";
  vi.mocked(readPrivateRepoFiles).mockReset().mockResolvedValue({ files: ["Dockerfile"], contents: { Dockerfile: "FROM nginx:alpine\nEXPOSE 80\n" } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    const procedure = parsed.pathname.replace("/api/", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ procedure, body, query: parsed.searchParams, cookie: new Headers(init.headers).get("cookie") });
    if (procedure === failure) return new Response(`clone https://oauth2:${sentinel}@git.example.test/repo failed`, { status: 400 });
    const provider = procedure.match(/^(github|gitlab|bitbucket|gitea)\.\1Providers$/)?.[1];
    if (provider) return Response.json(provider === denied || denied === "all" ? [] : [{
      [`${provider}Id`]: `${provider}-1`, gitProvider: { name: `${provider} connection` }, accessToken: sentinel, privateKey: sentinel,
    }]);
    if (procedure.endsWith("Repositories")) {
      return Response.json([{
        id: 42, name: procedure.startsWith("gitlab") || procedure.startsWith("bitbucket") ? "Display name differs" : "web",
        slug: "web", url: procedure.startsWith("gitlab") ? "team/subgroup/web" : "team/web", default_branch: "main",
        owner: { login: "team", username: "team" }, token: sentinel,
      }]);
    }
    if (procedure.endsWith("Branches")) return Response.json([{ name: "main", token: sentinel }]);
    switch (procedure) {
      case "sshKey.allForApps": return Response.json(denied === "ssh" || denied === "all" ? [] : [{ sshKeyId: "ssh-1", name: "Fixture key", privateKey: sentinel }]);
      case "compose.create": return Response.json({ composeId: "compose-1", appName });
      case "compose.one": return Response.json(detail);
      case "compose.update": Object.assign(detail, body); return Response.json(detail);
      case "compose.saveEnvironment": detail.env = body.env; return Response.json({});
      case "patch.saveFileAsPatch": patches[String(body.filePath)] = String(body.content); return Response.json({});
      case "patch.ensureRepo": return Response.json(`/etc/dokploy/patch-repos/compose/${appName}`);
      case "domain.generateDomain": return Response.json(host);
      case "domain.create": (detail.domains as unknown[]).push({ domainId: "domain-1", ...body }); return Response.json({});
      case "application.create": return Response.json({ applicationId: "app-1" });
      case "application.one": return Response.json({ appName, env: "", domains: [] });
      case "application.saveGithubProvider":
      case "application.update":
      case "application.deploy":
      case "compose.delete":
      case "compose.deploy": return Response.json({});
      default: throw new Error(`Unexpected procedure: ${procedure}`);
    }
  }));
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("connection discovery", () => {
  it("projects safe connections for the current user, with providers before SSH keys", async () => {
    const result = await gitConnectionsAction();
    expect(result.providers.map((provider) => provider.kind)).toEqual(["github", "gitlab", "bitbucket", "gitea", "ssh"]);
    expect(result.connectUrl).toMatch(/\/dashboard\/settings\/git-providers$/);
    expect(result.sshKeysUrl).toMatch(/\/dashboard\/settings\/ssh-keys$/);
    expect(result.bridge).toBe(true);
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(requests.every((request) => request.cookie === "dokploy-session=current-user")).toBe(true);
    expect(requests.some((request) => /\.one$|sshKey\.all$/.test(request.procedure))).toBe(false);
  });

  it("retains connection links and redacts upstream errors on discovery failure", async () => {
    failure = "gitlab.gitlabProviders";
    const result = await gitConnectionsAction();
    expect(result.providers).toEqual([]);
    expect(result.connectUrl).toMatch(/git-providers$/);
    expect(result.error).toContain("Check your access");
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("returns an empty selection and settings links when no connection exists", async () => {
    denied = "all";
    const result = await gitConnectionsAction();
    expect(result.providers).toEqual([]);
    expect(result.connectUrl).toMatch(/git-providers$/);
    expect(result.sshKeysUrl).toMatch(/ssh-keys$/);
    expect(result.error).toBeUndefined();
  });

  it.each<Exclude<GitProviderKind, "ssh">>(["github", "gitlab", "bitbucket", "gitea"])("normalizes %s repositories and branches without forwarding credentials", async (kind) => {
    const result = await gitRepositoriesAction(kind, `${kind}-1`);
    const key = kind === "gitlab" ? "team/subgroup/web" : "team/web";
    expect(result).toMatchObject({ ok: true, data: [{ key, name: "web", path: key }] });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(await gitBranchesAction(kind, `${kind}-1`, key)).toEqual({ ok: true, data: [{ name: "main" }] });
    const query = requests.at(-1)!.query;
    expect(query.get(`${kind}Id`)).toBe(`${kind}-1`);
    expect(query.get(kind === "gitea" ? "repositoryName" : "repo")).toBe("web");
    if (kind === "gitlab") expect(query.get("id")).toBe("42");
  });

  it("gates Swarm connections to the existing GitHub flow", async () => {
    vi.stubEnv("SWITCHYARD_DEPLOY_TARGET", "swarm");
    expect((await gitConnectionsAction()).providers.map((provider) => provider.kind)).toEqual(["github"]);
    expect(requests.map((request) => request.procedure)).toEqual(["github.githubProviders"]);
    expect(await quickDeployConnectedGitAction(input)).toEqual({ ok: true, id: "app-1" });
    expect(requests.some((request) => request.procedure.startsWith("compose."))).toBe(false);
  });

  it.each<GitProviderKind>(["gitlab", "bitbucket", "gitea", "ssh"])("rejects %s on Swarm before creating a project or app", async (kind) => {
    vi.stubEnv("SWITCHYARD_DEPLOY_TARGET", "swarm");
    const repository = kind === "ssh" ? "git@fixture-git:repos/demo.git" : "team/web";
    expect(await quickDeployConnectedGitAction({ ...input, providerKind: kind, repository, environmentId: undefined }))
      .toMatchObject({ ok: false, error: expect.stringContaining("only GitHub on Swarm hosts for now") });
    expect(requests).toEqual([]);
  });
});

describe("private bridge deployment", () => {
  it.each<GitProviderKind>(["github", "gitlab", "bitbucket", "gitea", "ssh"])("configures a native %s clone, a managed patch and the first-deploy URL", async (kind) => {
    const repository = kind === "ssh" ? "ssh://git@fixture-git:2222/repos/demo.git" : kind === "gitlab" ? "team/subgroup/web" : "team/web";
    expect(await quickDeployConnectedGitAction({ ...input, providerKind: kind, providerId: `${kind}-1`, repository, subdirectory: "apps/web", dockerfile: "docker/Production" }))
      .toEqual({ ok: true, id: "compose-1" });
    expect(detail).toMatchObject({ sourceType: kind === "ssh" ? "git" : kind, composePath: "../switchyard.compose.yaml", composeType: "docker-compose", isolatedDeployment: false, env: "PORT=8080", enableSubmodules: false });
    if (kind === "ssh") expect(detail).toMatchObject({ customGitSSHKeyId: "ssh-1", customGitUrl: repository, customGitBranch: "main" });
    else if (kind === "github") expect(detail).toMatchObject({ githubId: "github-1", owner: "team", repository: "web", branch: "main" });
    else expect(detail).toMatchObject({ [`${kind}Id`]: `${kind}-1`, [`${kind}Repository`]: "web", [`${kind}Branch`]: "main" });
    if (kind === "gitlab") expect(detail).toMatchObject({ gitlabProjectId: 42, gitlabPathNamespace: "team/subgroup/web" });
    if (kind === "bitbucket") expect(detail.bitbucketRepositorySlug).toBe("web");
    expect(parseManaged(String(detail.composeFile))).toMatchObject({ repoProvider: kind, buildKind: "dockerfile", buildPort: 8080, autoDomain: { host, port: 8080 } });
    expect(patches["../switchyard.compose.yaml"]).toBe(detail.composeFile);
    expect(String(detail.composeFile)).toContain("context: ./.switchyard-source/apps/web");
    expect(JSON.stringify(requests)).not.toContain(sentinel);
    expect(JSON.stringify(parseManaged(String(detail.composeFile)))).not.toContain(`${kind}-1`);
    const deployment = requests.findIndex((request) => request.procedure === "compose.deploy");
    expect(requests.findIndex((request) => request.procedure === "patch.saveFileAsPatch")).toBeLessThan(deployment);
    expect(requests.findIndex((request) => request.procedure === "domain.create")).toBeLessThan(deployment);
    expect(fetchRepoBuildFiles).not.toHaveBeenCalled();
    expect(fetchRepoExposedPorts).not.toHaveBeenCalled();
  });

  it("routes the existing GitHub quick action through a native clone on bridge", async () => {
    expect(await quickDeployGithubAction({ githubId: "github-1", owner: "team", repository: "web", branch: "main", environmentId: "env-1" }))
      .toEqual({ ok: true, id: "compose-1" });
    expect(detail.sourceType).toBe("github");
    expect(parseManaged(String(detail.composeFile))).toMatchObject({ buildPort: 80, autoDomain: { host, port: 80 } });
  });

  it("forwards the GitHub form's explicit port instead of hardcoding 3000", async () => {
    expect(await quickDeployGithubAction({ githubId: "github-1", owner: "team", repository: "web", branch: "main", port: 9090, environmentId: "env-1" }))
      .toEqual({ ok: true, id: "compose-1" });
    expect(detail.env).toBe("PORT=9090");
    expect(parseManaged(String(detail.composeFile))).toMatchObject({ buildPort: 9090, autoDomain: { host, port: 9090 } });
  });

  it.each<{ kind: string; port: number; contents: Record<string, string> }>([
    { kind: "node", port: 3000, contents: { "package.json": '{"scripts":{"start":"node server.js"}}' } },
    { kind: "python", port: 8000, contents: { "requirements.txt": "flask", "app.py": "", Procfile: "web: gunicorn app:app" } },
    { kind: "go", port: 8080, contents: { "go.mod": "module example.test/demo" } },
    { kind: "static", port: 80, contents: { "index.html": "<h1>Demo</h1>" } },
  ])("detects a private $kind repo before the first domain/deploy", async ({ kind, port, contents }) => {
    const files = { files: Object.keys(contents), contents };
    vi.mocked(readPrivateRepoFiles).mockResolvedValue(files);
    expect(await quickDeployConnectedGitAction({ ...input, port: undefined })).toEqual({ ok: true, id: "compose-1" });
    expect(readPrivateRepoFiles).toHaveBeenCalledWith(`/etc/dokploy/patch-repos/compose/${appName}`, appName, undefined, undefined);
    expect(String(detail.composeFile)).toContain("dockerfile_inline:");
    expect(detail.env).toBe(`PORT=${port}`);
    expect(parseManaged(String(detail.composeFile))).toMatchObject({ buildKind: kind, buildPort: port, autoDomain: { host, port } });
    expect(requests.findIndex((r) => r.procedure === "patch.ensureRepo")).toBeLessThan(requests.findIndex((r) => r.procedure === "domain.create"));
  });

  it("keeps a Dockerfile authoritative over manifests", async () => {
    vi.mocked(readPrivateRepoFiles).mockResolvedValue({ files: ["Dockerfile", "package.json"], contents: { Dockerfile: "FROM nginx:alpine\nEXPOSE 8181", "package.json": "invalid" } });
    expect(await quickDeployConnectedGitAction({ ...input, port: undefined })).toEqual({ ok: true, id: "compose-1" });
    expect(String(detail.composeFile)).not.toContain("dockerfile_inline:");
    expect(parseManaged(String(detail.composeFile))).toMatchObject({ buildKind: "dockerfile", buildPort: 8181 });
  });

  it("lets an explicit port override the auto-detected builder", async () => {
    vi.mocked(readPrivateRepoFiles).mockResolvedValue({ files: ["index.html"], contents: {} });
    expect(await quickDeployConnectedGitAction(input)).toEqual({ ok: true, id: "compose-1" });
    expect(detail.env).toBe("PORT=8080");
    expect(parseManaged(String(detail.composeFile))).toMatchObject({ buildKind: "static", buildPort: 8080, autoDomain: { host, port: 8080 } });
  });

  it.each(["unknown", "clone", "read"])("removes only the new undeployed service on %s failure", async (mode) => {
    if (mode === "clone") failure = "patch.ensureRepo";
    else if (mode === "read") vi.mocked(readPrivateRepoFiles).mockRejectedValue(new Error(sentinel));
    else vi.mocked(readPrivateRepoFiles).mockResolvedValue({ files: ["README.md"], contents: {} });
    const result = await quickDeployConnectedGitAction(input);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("supported Node, Python, Go or static app") });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(requests.filter((r) => r.procedure === "compose.delete").map((r) => r.body)).toEqual([{ composeId: "compose-1" }]);
    expect(requests.some((r) => r.procedure === "domain.create" || r.procedure === "compose.deploy")).toBe(false);
  });

  it.each<GitProviderKind>(["github", "gitlab", "bitbucket", "gitea", "ssh"])("rejects a %s connection the current user cannot see before creating anything", async (kind) => {
    denied = kind;
    const repository = kind === "ssh" ? "git@fixture-git:repos/demo.git" : "team/web";
    expect(await quickDeployConnectedGitAction({ ...input, providerKind: kind, providerId: `${kind}-1`, repository })).toMatchObject({ ok: false });
    expect(requests.some((request) => request.procedure === "compose.create" || request.procedure.startsWith("project."))).toBe(false);
  });

  it.each([{ repository: "another/secret" }, { branch: "hidden" }])("rejects a forged repository or branch selection", async (patch) => {
    expect(await quickDeployConnectedGitAction({ ...input, ...patch })).toMatchObject({ ok: false });
    expect(requests.some((request) => request.procedure === "compose.create")).toBe(false);
  });

  it("rejects pasted credentials before any API request", async () => {
    const result = await quickDeployConnectedGitAction({ ...input, providerKind: "ssh", repository: `https://user:${sentinel}@git.example.test/repo.git` });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(requests).toEqual([]);
  });

  it("never spreads extra client credential fields into the native config or managed metadata", async () => {
    const untrusted = { ...input, token: sentinel, privateKey: sentinel, owner: "forged" };
    expect(await quickDeployConnectedGitAction(untrusted)).toEqual({ ok: true, id: "compose-1" });
    expect(JSON.stringify(requests)).not.toContain(sentinel);
    expect(detail.owner).toBe("team");
  });

  it("preserves ordinary Compose edits on engines that return an empty update response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    await expect(updateComposeFile("compose-1", "services: {}\n")).resolves.toBeUndefined();
  });

  it("does not deploy if writing the managed patch fails or expose the upstream error", async () => {
    failure = "patch.saveFileAsPatch";
    const result = await quickDeployConnectedGitAction(input);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(requests.some((request) => request.procedure === "compose.deploy")).toBe(false);
  });

  it("keeps the native patch synchronized on edits and redeploys, even if metadata is removed", async () => {
    await quickDeployConnectedGitAction(input);
    const edited = String(detail.composeFile).replace("    restart: unless-stopped", "    restart: always");
    await updateComposeFile("compose-1", edited);
    expect(patches["../switchyard.compose.yaml"]).toBe(edited);
    await composeAction("compose-1", "deploy");
    expect(detail.sourceType).toBe("github");
    const withoutMetadata = edited.slice(edited.indexOf("services:"));
    await updateComposeFile("compose-1", withoutMetadata);
    expect(patches["../switchyard.compose.yaml"]).toBe(withoutMetadata);
  });
});
