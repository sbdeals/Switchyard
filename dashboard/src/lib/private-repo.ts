/** Client-safe descriptions of Dokploy connections. Never carry provider credentials. */
export const GIT_PROVIDER_LABELS = {
  github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket", gitea: "Gitea", ssh: "SSH key",
} as const;
export type GitProviderKind = keyof typeof GIT_PROVIDER_LABELS;
export interface GitConnection { kind: GitProviderKind; id: string; name: string }
export interface GitRepository {
  key: string;
  owner: string;
  name: string;
  /** GitLab's full namespace, including subgroups. */
  path: string;
  projectId?: number;
  defaultBranch?: string;
}
export interface PrivateRepoInput {
  providerKind: GitProviderKind;
  providerId: string;
  /** A key returned by the provider's repository list; an SSH URL for custom Git. */
  repository: string;
  branch: string;
  subdirectory?: string;
  dockerfile?: string;
  /** Omit to use the detected builder or Dockerfile port. */
  port?: number;
}

// Siblings of Dokploy's code/ clone: a tracked symlink cannot redirect our writes.
export const PRIVATE_COMPOSE_PATH = "../switchyard.compose.yaml";
export const PRIVATE_SOURCE_DIR = ".switchyard-source";

function relativePath(value: string): boolean {
  return /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) &&
    value.split("/").every((part) => part !== "." && part !== "..");
}

/** Only SSH identities, never HTTP credentials, query tokens or shell syntax. */
export function validSshRepoUrl(value: string): boolean {
  const match = value.match(/^(?:ssh:\/\/([a-z_][a-z0-9_-]*)@([A-Za-z0-9][A-Za-z0-9.-]*)(?::([0-9]{1,5}))?\/|([a-z_][a-z0-9_-]*)@([A-Za-z0-9][A-Za-z0-9.-]*):)([A-Za-z0-9_./-]+)$/);
  return !!match && (!match[3] || (Number(match[3]) >= 1 && Number(match[3]) <= 65535)) && relativePath(match[6]);
}

/** Errors deliberately don't echo input, which may contain pasted credentials. */
export function validatePrivateRepoInput(input: PrivateRepoInput): void {
  if (!Object.hasOwn(GIT_PROVIDER_LABELS, input.providerKind) ||
    typeof input.providerId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(input.providerId)) {
    throw new Error("Select a connected Git provider or SSH key.");
  }
  if (typeof input.repository !== "string" || (input.providerKind === "ssh"
    ? !validSshRepoUrl(input.repository) : !relativePath(input.repository))) {
    throw new Error("Select a repository, or enter an SSH URL such as git@host:owner/repo.git without credentials.");
  }
  if (typeof input.branch !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input.branch) ||
    input.branch.includes("..") || input.branch.includes("//") || /[/.]$|\.lock(?:\/|$)/.test(input.branch)) {
    throw new Error("Enter a valid Git branch.");
  }
  if ((input.subdirectory && !relativePath(input.subdirectory)) ||
    (input.dockerfile && !relativePath(input.dockerfile))) {
    throw new Error("Subdirectory and Dockerfile must be relative paths without .. or special characters.");
  }
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) {
    throw new Error("App port must be between 1 and 65535.");
  }
}

/** Also used to gate the form; server-side validation remains authoritative. */
export function canDeployPrivateRepo(input: PrivateRepoInput, busy: boolean): boolean {
  if (busy) return false;
  try { validatePrivateRepoInput(input); return true; } catch { return false; }
}

/** Native Dokploy accepts docker-compose command chains, but no shell scripts. */
export function privateRepoCommand(appName: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(appName)) throw new Error("Invalid Compose project name.");
  const compose = `compose -p ${appName} --env-file ../.env -f ${PRIVATE_COMPOSE_PATH}`;
  return `${compose} run --rm --no-deps switchyard-source && docker ${compose} up -d --build --remove-orphans app`;
}

/** The build context itself must not follow a tracked symlink out to the clone. */
export function privateRepoSourceCommand(subdirectory?: string): string {
  if (subdirectory && !relativePath(subdirectory)) throw new Error("Invalid build subdirectory.");
  const context = `/source${subdirectory ? `/${subdirectory}` : ""}`;
  return "set -o pipefail; find /source -mindepth 1 -maxdepth 1 -exec rm -rf {} +; " +
    "git -c safe.directory=/repo -C /repo archive HEAD | tar -x -C /source; " +
    `test -d ${context} && test "$(readlink -f ${context})" = ${context} || ` +
    '{ echo "Build subdirectory must be a real directory inside the repository."; exit 1; }';
}
