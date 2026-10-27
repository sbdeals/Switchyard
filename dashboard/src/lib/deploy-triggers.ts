export type DeployTriggerKind = "application" | "compose";

export type DeployTriggerInput = {
  autoDeploy: boolean;
  watchPaths: string;
};

// Dashboard input bounds; Dokploy's schema does not impose these limits.
export const MAX_WATCH_PATHS_LENGTH = 16_384;
export const MAX_WATCH_PATH_LENGTH = 512;
export const MAX_WATCH_PATHS = 100;

export function isGitSource(sourceType: unknown): boolean {
  return ["git", "github", "gitlab", "bitbucket", "gitea"].some(
    (source) => source === sourceType
  );
}

export function parseDeployTriggers(input: unknown): {
  autoDeploy: boolean;
  watchPaths: string[];
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid deploy trigger settings.");
  }
  const { autoDeploy, watchPaths } = input as Record<string, unknown>;
  if (typeof autoDeploy !== "boolean") {
    throw new Error("Auto-deploy must be enabled or disabled.");
  }
  if (typeof watchPaths !== "string") {
    throw new Error("Watch paths must contain one glob per line.");
  }
  if (watchPaths.length > MAX_WATCH_PATHS_LENGTH) {
    throw new Error(`Watch paths must be at most ${MAX_WATCH_PATHS_LENGTH} characters.`);
  }
  if (Array.from(watchPaths).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && character !== "\n" && character !== "\r") || code === 127;
  })) {
    throw new Error("Watch paths cannot contain control characters.");
  }

  const patterns = watchPaths.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
  if (patterns.length > MAX_WATCH_PATHS) {
    throw new Error(`Use at most ${MAX_WATCH_PATHS} watch paths.`);
  }
  for (const pattern of patterns) {
    if (pattern.length > MAX_WATCH_PATH_LENGTH) {
      throw new Error(`Each watch path must be at most ${MAX_WATCH_PATH_LENGTH} characters.`);
    }
    if (/^!+$/.test(pattern)) {
      throw new Error("A negated watch path must include a glob after !.");
    }
  }
  return { autoDeploy, watchPaths: patterns };
}
