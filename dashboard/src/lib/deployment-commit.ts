/** Commit metadata recorded on a deployment, independent of Dokploy I/O. */
export interface DeploymentCommit {
  sha: string | null;
  subject: string | null;
  branch: string | null;
  url: string | null;
}

export interface DeploymentCommitFields {
  title?: string | null;
  description?: string | null;
  commitHash?: string | null;
  commitMessage?: string | null;
  branch?: string | null;
}

/** The source fields shared by application.one and compose.one. */
export interface DeploymentSource {
  sourceType?: string | null;
  customGitUrl?: string | null;
  owner?: string | null;
  repository?: string | null;
  github?: { githubUrl?: string | null } | null;
}

const GIT_SOURCES = new Set(["git", "github", "gitlab", "bitbucket", "gitea"]);
const SHA = /^(?:[a-f\d]{7,40}|[a-f\d]{64})$/i;

function text(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function commitHash(value: string | null | undefined): string | null {
  const hash = text(value);
  return hash && SHA.test(hash) ? hash.toLowerCase() : null;
}

/** Only literal HTTPS github.com repository URLs may become commit links. */
function githubRepository(source: DeploymentSource): string | null {
  let repository: string | null = null;
  if (source.sourceType === "git") {
    repository = text(source.customGitUrl);
  } else if (source.sourceType === "github" && source.owner && source.repository) {
    const provider = text(source.github?.githubUrl) ?? "https://github.com";
    if (!/^https:\/\/github\.com\/?$/i.test(provider)) return null;
    repository = `${provider.replace(/\/$/, "")}/${source.owner}/${source.repository}`;
  }
  // Reject credentials, ports, query strings, fragments, SSH, enterprise hosts
  // and extra path segments rather than turning them into misleading links.
  const match = repository?.match(/^https:\/\/github\.com\/([\w-]+)\/([\w.-]+?)\/?$/i);
  if (!match) return null;
  const repo = match[2].replace(/\.git$/i, "");
  if (!repo || repo === "." || repo === "..") return null;
  return `https://github.com/${match[1]}/${repo}`;
}

export function normalizeDeploymentCommit(
  deployment: DeploymentCommitFields,
  source: DeploymentSource,
): DeploymentCommit | null {
  if (!source.sourceType || !GIT_SOURCES.has(source.sourceType)) return null;

  // v0.30.10 stores git log %B in title and `Commit: <hash>` in description.
  // Webhook deployments initially use `Hash: <hash>` instead. An arbitrary
  // deployment title alone is not evidence of a commit message.
  const recorded = text(deployment.description)?.match(/^(Commit|Hash):\s*(\S+)$/i);
  const sha = commitHash(deployment.commitHash) ?? commitHash(recorded?.[2]);
  // Pending tag/preview webhooks have event labels in title, not git subjects.
  const eventTitle = recorded?.[1].toLowerCase() === "hash" &&
    /^(?:Preview Deployment|Tag created: .*)$/i.test(text(deployment.title) ?? "");
  const message = text(deployment.commitMessage) ?? (sha && !eventTitle ? text(deployment.title) : null);
  const subject = message?.split(/\r?\n/, 1)[0].trim() || null;
  // Do not substitute the service's current branch for a historical branch.
  const branch = text(deployment.branch)?.replace(/^refs\/heads\//, "") || null;
  if (!sha && !subject && !branch) return null;

  const repository = githubRepository(source);
  return { sha, subject, branch, url: sha && repository ? `${repository}/commit/${sha}` : null };
}

/** Select the latest row even if it has no commit metadata. Never mutate history. */
export function newestDeployment<T extends { createdAt: string }>(history: readonly T[]): T | null {
  return history.reduce<T | null>(
    (latest, deployment) => !latest || deployment.createdAt > latest.createdAt ? deployment : latest,
    null,
  );
}
