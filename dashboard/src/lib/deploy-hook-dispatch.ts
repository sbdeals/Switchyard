import "server-only";
import { resolveRepoCommit } from "./git-remote";
import { resolveDeployHook, type DeployHookRecord } from "./deploy-hook-store";

/** Dispatch with a service-only capability, never a user cookie or API key. */
export async function dispatchDeployHook(hook: DeployHookRecord): Promise<boolean> {
  const commit = await resolveRepoCommit(hook.repoUrl, hook.branch).catch(() => null);
  // A disable/rotation/source edit during metadata lookup must cancel this request.
  const current = resolveDeployHook(hook.token);
  if (!current || current.refreshToken !== hook.refreshToken || current.branch !== hook.branch ||
    current.repoUrl !== hook.repoUrl) return false;
  const title = commit
    ? `Deploy ${commit.sha.slice(0, 7)}${commit.headline ? ` · ${commit.headline}` : ""}`
    : "Deploy on push";
  await dispatchComposeHook(hook.refreshToken, hook.branch, commit?.sha ?? "", title);
  return true;
}

/** Shared native dispatch for pushes and owned PR preview stacks. */
export async function dispatchComposeHook(refreshToken: string, branch: string, sha: string, title: string): Promise<void> {
  // v0.30.10's compose webhook accepts raw compose and takes its title/hash
  // from a GitHub-shaped payload. Only send our resolved metadata, not user input.
  const base = process.env.DOKPLOY_URL ?? "http://localhost:3000";
  const response = await fetch(new URL(`/api/deploy/compose/${encodeURIComponent(refreshToken)}`, base), {
    method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, head_commit: { id: sha, message: title } }),
    signal: AbortSignal.timeout(5000),
  });
  void response.body?.cancel().catch(() => {});
  if (!response.ok) throw new Error("Deploy webhook unavailable. Re-enable it in service Settings.");
}
