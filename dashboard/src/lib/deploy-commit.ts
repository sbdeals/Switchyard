import "server-only";
import { parseManaged } from "./managed-compose";
import { resolveRepoCommit } from "./git-remote";

/** Optional display metadata; failure must never prevent a build. */
export async function repoDeploymentLabel(composeFile: string | null | undefined): Promise<{
  title?: string;
  description?: string;
}> {
  const managed = parseManaged(composeFile);
  if (managed?.kind !== "repo") return {};
  try {
    const commit = await resolveRepoCommit(managed.repoUrl, managed.branch);
    if (!commit) return {};
    return {
      title: `Deploy ${commit.sha.slice(0, 7)}${commit.headline ? ` · ${commit.headline}` : ""}`,
      description: `Branch ${managed.branch} at deploy request: ${commit.sha}${commit.headline ? `\n${commit.headline}` : ""}`,
    };
  } catch {
    return {};
  }
}
