import { CONFIG_FILES, parseConfigFile, type ParsedConfig } from "./config-as-code";

const MAX_CONFIG_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

function publicRepoPath(repoUrl: string): string {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)\/?$/.exec(repoUrl);
  const repository = match?.[2].replace(/\.git$/, "");
  if (!match || match[0] !== repoUrl || !repository || /^\.+$/.test(repository)) {
    throw new Error("Enter a public GitHub repository URL: https://github.com/owner/repo.");
  }
  return `${match[1]}/${repository}`;
}

function encodedBranch(branch: string): string {
  if (
    !branch || branch === "@" || branch.includes("..") || branch.includes("@{") ||
    /[\x00-\x20\x7f~^:?*\[\\]/.test(branch) || branch.endsWith(".") ||
    branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new Error("Enter a valid Git branch or commit reference.");
  }
  return encodeURIComponent(branch);
}

async function readConfigText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_CONFIG_BYTES) {
    await response.body?.cancel();
    throw new Error("Config files must be no larger than 64 KiB.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CONFIG_BYTES) {
        throw new Error("Config files must be no larger than 64 KiB.");
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Read public repository files only; no GitHub credentials or provider APIs. */
export async function fetchPublicRepoConfig(
  repoUrl: string,
  branch = "main",
  fetcher: typeof fetch = fetch,
): Promise<ParsedConfig | null> {
  const repository = publicRepoPath(repoUrl);
  const reference = encodedBranch(branch);
  for (const file of CONFIG_FILES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetcher(`https://raw.githubusercontent.com/${repository}/${reference}/${file}`, {
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 404) {
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Could not read ${file} (HTTP ${response.status}).`);
      }
      return parseConfigFile(file, await readConfigText(response));
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Timed out reading ${file}.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}
