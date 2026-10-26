import "server-only";
import { createManagedCompose, composeAction, ensureBridgeAutoDomain, request, updateComposeFile, saveComposeEnvironment } from "./dokploy";
import { detectBuildPlan } from "./build-plan";
import { resolveAppPort } from "./app-port";
import { readPrivateRepoFiles } from "./private-repo-files";
import { parseDockerfileExposedPorts } from "./repo-port";
import { providerRepoStack } from "./managed-compose";
import {
  GIT_PROVIDER_LABELS, PRIVATE_COMPOSE_PATH, privateRepoCommand, validatePrivateRepoInput,
  type GitConnection, type GitProviderKind, type GitRepository, type PrivateRepoInput,
} from "./private-repo";

const PROVIDERS = ["github", "gitlab", "bitbucket", "gitea"] as const;
const REPOSITORIES = {
  github: "github.getGithubRepositories", gitlab: "gitlab.getGitlabRepositories",
  bitbucket: "bitbucket.getBitbucketRepositories", gitea: "gitea.getGiteaRepositories",
} as const;
const BRANCHES = {
  github: "github.getGithubBranches", gitlab: "gitlab.getGitlabBranches",
  bitbucket: "bitbucket.getBitbucketBranches", gitea: "gitea.getGiteaBranches",
} as const;

/** Only list endpoints: provider.one and sshKey.all/one contain credentials. */
export async function listGitConnections(bridge: boolean): Promise<GitConnection[]> {
  const kinds = bridge ? PROVIDERS : ["github"] as const;
  const lists = await Promise.all(kinds.map(async (kind) => {
    const rows = await request<{ [key: string]: unknown; gitProvider?: { name?: string } }[]>(`${kind}.${kind}Providers`);
    return rows.map((row) => ({ kind, id: String(row[`${kind}Id`]), name: row.gitProvider?.name ?? GIT_PROVIDER_LABELS[kind] }));
  }));
  const connections: GitConnection[] = lists.flat();
  if (bridge) {
    const keys = await request<{ sshKeyId: string; name: string }[]>("sshKey.allForApps");
    connections.push(...keys.map((key) => ({ kind: "ssh" as const, id: key.sshKeyId, name: key.name })));
  }
  return connections;
}

async function requireConnection(kind: GitProviderKind, id: string, bridge: boolean): Promise<GitConnection> {
  const connection = (await listGitConnections(bridge)).find((item) => item.kind === kind && item.id === id);
  if (!connection) throw new Error("Git connection is unavailable to this user.");
  return connection;
}

interface RawRepo {
  id?: number;
  name: string;
  slug?: string;
  url?: string;
  default_branch?: string;
  owner?: { login?: string; username?: string };
}

async function repositoriesFor(connection: GitConnection): Promise<GitRepository[]> {
  const { kind, id } = connection;
  if (kind === "ssh") return [];
  const rows = await request<RawRepo[]>(`${REPOSITORIES[kind]}?${kind}Id=${encodeURIComponent(id)}`);
  return rows.flatMap((row): GitRepository[] => {
    // GitLab/Gitea return a full namespace, not a clone URL. Never forward the
    // provider's arbitrary response or an authenticated URL to the browser.
    const owner = row.owner?.login ?? row.owner?.username ?? "";
    const path = kind === "gitlab" || kind === "gitea" ? row.url ?? "" : `${owner}/${row.slug ?? row.name}`;
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(path) || path.split("/").some((part) => part === "." || part === "..")) return [];
    return [{
      key: path, path, owner: path.slice(0, path.lastIndexOf("/")), name: path.slice(path.lastIndexOf("/") + 1),
      ...(kind === "gitlab" && Number.isSafeInteger(row.id) && row.id! > 0 ? { projectId: row.id } : {}),
      ...(row.default_branch ? { defaultBranch: row.default_branch } : {}),
    }];
  }).sort((a, b) => a.key.localeCompare(b.key));
}

export async function listGitRepositories(kind: GitProviderKind, id: string, bridge: boolean): Promise<GitRepository[]> {
  return repositoriesFor(await requireConnection(kind, id, bridge));
}

async function selectedRepository(connection: GitConnection, key: string): Promise<GitRepository> {
  const repo = (await repositoriesFor(connection)).find((item) => item.key === key);
  if (!repo) throw new Error("Repository is unavailable to this connection.");
  return repo;
}

async function branchesFor(connection: GitConnection, repo: GitRepository): Promise<{ name: string }[]> {
  const { kind, id } = connection;
  if (kind === "ssh") return [];
  const params = new URLSearchParams({ [`${kind}Id`]: id, owner: repo.owner });
  params.set(kind === "gitea" ? "repositoryName" : "repo", repo.name);
  if (kind === "gitlab") {
    if (!repo.projectId) throw new Error("GitLab project ID is missing.");
    params.set("id", String(repo.projectId));
  }
  const rows = await request<{ name: string }[]>(`${BRANCHES[kind]}?${params}`);
  return rows.map((row) => ({ name: row.name }));
}

export async function listGitBranches(kind: GitProviderKind, id: string, key: string, bridge: boolean): Promise<{ name: string }[]> {
  const connection = await requireConnection(kind, id, bridge);
  return branchesFor(connection, await selectedRepository(connection, key));
}

/** Resolve all provider fields on the server, under the current user's session. */
export async function resolvePrivateRepo(input: PrivateRepoInput, bridge: boolean) {
  validatePrivateRepoInput(input);
  const connection = await requireConnection(input.providerKind, input.providerId, bridge);
  let fields: Record<string, string | number>;
  let repoUrl: string;
  if (connection.kind === "ssh") {
    fields = { sourceType: "git", customGitSSHKeyId: connection.id, customGitUrl: input.repository, customGitBranch: input.branch };
    repoUrl = input.repository;
  } else {
    const repo = await selectedRepository(connection, input.repository);
    if (!(await branchesFor(connection, repo)).some((item) => item.name === input.branch)) {
      throw new Error("Branch is unavailable to this connection.");
    }
    const { kind, id } = connection;
    fields = kind === "github"
      ? { sourceType: kind, githubId: id, owner: repo.owner, repository: repo.name, branch: input.branch }
      : { sourceType: kind, [`${kind}Id`]: id, [`${kind}Owner`]: repo.owner, [`${kind}Repository`]: repo.name, [`${kind}Branch`]: input.branch };
    if (kind === "gitlab") Object.assign(fields, { gitlabProjectId: repo.projectId!, gitlabPathNamespace: repo.path });
    if (kind === "bitbucket") fields.bitbucketRepositorySlug = repo.name;
    // A namespace is sufficient for display; don't guess a host for enterprise providers.
    repoUrl = repo.path;
  }
  return { input, fields, repoUrl };
}

export async function deployPrivateBridgeRepo(
  name: string, source: Awaited<ReturnType<typeof resolvePrivateRepo>>, environmentId: string,
): Promise<string> {
  const { input, fields, repoUrl } = source;
  let appName = "";
  const stack = (port: number) => ({ appName, repoUrl, branch: input.branch, subdirectory: input.subdirectory,
    dockerfile: input.dockerfile, repoProvider: input.providerKind, port });
  const id = await createManagedCompose(name, environmentId, (createdName) => {
    appName = createdName;
    return {
      composeFile: providerRepoStack(stack(input.port ?? 3000)),
      source: {
        ...fields, composePath: PRIVATE_COMPOSE_PATH, command: privateRepoCommand(appName),
        enableSubmodules: false, autoDeploy: false,
      },
    };
  });
  try {
    // Dokploy keeps the authentication. Its file-editor clone is archived in a
    // networkless helper; only bounded, regular manifest files reach the detector.
    const repoPath = await request<string>("patch.ensureRepo", { method: "POST", body: { id, type: "compose" } });
    const files = await readPrivateRepoFiles(repoPath, appName, input.subdirectory, input.dockerfile);
    const plan = detectBuildPlan(files);
    const port = plan.kind === "dockerfile"
      ? resolveAppPort({ port: input.port, exposedPorts: parseDockerfileExposedPorts(files.contents.Dockerfile ?? "") })
      : input.port ?? plan.port;
    await updateComposeFile(id, providerRepoStack(stack(port), { ...plan, port }));
    await saveComposeEnvironment(id, `PORT=${port}`);
  } catch {
    // No deployment exists yet. Remove only the service created by this request.
    await composeAction(id, "remove");
    throw new Error("Could not detect the private repository build.");
  }
  try { await ensureBridgeAutoDomain(id); } catch { /* Networking can retry URL provisioning. */ }
  await composeAction(id, "deploy");
  return id;
}
