import { validateRepoSource } from "./managed-compose";
import { decodeStoredEnv, templateEntries } from "./references";

export const PREVIEW_LIMIT = 5;

/** Vault references are explicitly secret. Plain bridge variables have no
 * secret/sealed flag; copy their saved values, without reference annotations. */
export function previewEnvironment(env: string | null): string {
  const entries = templateEntries(env);
  const templates = new Map(templateEntries(decodeStoredEnv(env)));
  const omitted = new Set<string>();
  for (const [key, value] of [...entries, ...templates]) {
    if (/\$\{\{\s*vault\s*\./i.test(value)) omitted.add(key);
  }
  // Omit aliases too, including an already-resolved annotated value.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, value] of [...entries, ...templates]) {
      if (omitted.has(key)) continue;
      const refs = [...value.matchAll(/\$\{\{?\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}?/g)];
      if (refs.some((match) => omitted.has(match[1]))) { omitted.add(key); changed = true; }
    }
  }
  return entries.filter(([key]) => !omitted.has(key)).map(([key, value]) => `${key}=${value}`).join("\n");
}

export interface PreviewRecord {
  number: number;
  marker: string;
  name: string;
  environmentId: string;
  serviceId?: string;
  appName?: string;
  repoUrl: string;
  branch: string;
  sha: string;
  title: string;
  url?: string;
  lastAction?: string;
  deleting?: boolean;
}

export interface PullRequestEvent {
  action: "opened" | "reopened" | "synchronize" | "closed";
  number: number;
  repoUrl: string;
  branch: string;
  sha: string;
  title: string;
  fork: boolean;
}

// GitHub PR hooks accept public GitHub sources only, never payload-supplied
// credentials, local hosts, arbitrary build contexts, or repository redirects.
export function githubRepo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!match || [match[1], match[2]].some((part) => part === "." || part === "..")) return null;
  return `${match[1]}/${match[2]}`.toLowerCase();
}

/** null means an unsupported action; malformed supported events are rejected. */
export function parsePullRequest(payload: unknown, parentRepo: string): PullRequestEvent | null {
  if (!payload || typeof payload !== "object") throw new Error("Invalid pull request.");
  const data = payload as Record<string, unknown>;
  if (!["opened", "reopened", "synchronize", "closed"].includes(String(data.action))) return null;
  const pr = data.pull_request as {
    number?: unknown; title?: unknown;
    base?: { repo?: { clone_url?: unknown } };
    head?: { ref?: unknown; sha?: unknown; repo?: { clone_url?: unknown } };
  } | undefined;
  const parent = githubRepo(parentRepo);
  const number = data.number;
  if (!parent || !Number.isSafeInteger(number) || Number(number) < 1 ||
    !pr || pr.number !== number || githubRepo(pr.base?.repo?.clone_url) !== parent) {
    throw new Error("Invalid pull request.");
  }
  // GitHub can omit head.repo after a fork is deleted. Closing needs only the
  // signed base repository and PR number; it must still clean up that preview.
  if (data.action === "closed") return {
    action: "closed", number: Number(number), repoUrl: "", branch: "", sha: "", title: "", fork: false,
  };
  const repoUrl = pr.head?.repo?.clone_url;
  const repo = githubRepo(repoUrl);
  const branch = pr.head?.ref;
  const sha = pr.head?.sha;
  if (!repo || typeof repoUrl !== "string" || typeof branch !== "string" || branch.length > 1024 ||
    typeof sha !== "string" || !/^[a-fA-F0-9]{40}$/.test(sha) || /^0+$/.test(sha) || typeof pr.title !== "string") {
    throw new Error("Invalid pull request.");
  }
  validateRepoSource({ repoUrl, branch });
  return {
    action: data.action as PullRequestEvent["action"], number: Number(number), repoUrl, branch,
    sha: sha.toLowerCase(), title: pr.title.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 240), fork: repo !== parent,
  };
}

export function previewDescription(parentId: string, marker: string): string {
  return `switchyard-preview:${parentId}:${marker}`;
}
