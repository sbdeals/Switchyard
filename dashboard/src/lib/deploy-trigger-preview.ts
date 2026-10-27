import micromatch from "micromatch";
import { MAX_WATCH_PATH_LENGTH } from "./deploy-triggers";

export const MAX_PREVIEW_PATHS = 20;

/**
 * Dokploy v0.30.10 uses micromatch 4.0.8 with default options and the entire
 * ordered pattern set, so negations exclude and later positive patterns reinclude.
 * Matching is case-sensitive; wildcards exclude dotfiles unless explicitly named.
 * Empty/null watch paths allow all changes. Keep this module off the client bundle.
 * https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/watch-paths/should-deploy.ts
 */
export function previewDeployTriggers(
  autoDeploy: boolean,
  watchPaths: string[] | null,
  paths: string[]
): { path: string; matches: boolean; triggers: boolean }[] {
  if (!Array.isArray(paths) || paths.length > MAX_PREVIEW_PATHS) {
    throw new Error(`Preview at most ${MAX_PREVIEW_PATHS} example paths.`);
  }
  for (const path of paths) {
    if (typeof path !== "string" || !path.trim() || path.length > MAX_WATCH_PATH_LENGTH) {
      throw new Error(`Each example path must contain 1–${MAX_WATCH_PATH_LENGTH} characters.`);
    }
    if (Array.from(path).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })) {
      throw new Error("Example paths cannot contain control characters.");
    }
  }
  const matchingPaths = new Set(
    watchPaths?.length ? micromatch(paths, watchPaths) : paths
  );
  return paths.map((path) => {
    const matches = matchingPaths.has(path);
    return { path, matches, triggers: autoDeploy && matches };
  });
}
