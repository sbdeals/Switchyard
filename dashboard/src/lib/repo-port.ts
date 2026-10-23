import "server-only";

interface RepoSource {
  repoUrl: string;
  branch: string;
  subdirectory?: string;
  dockerfile?: string;
}

const DOCKERFILE_MAX_BYTES = 128 * 1024;
const configuredTimeout = Number(process.env.REPO_DOCKERFILE_TIMEOUT_MS);
const DOCKERFILE_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout : 5_000;

/** Static hints only: never evaluate arguments, shell commands, or inherited image metadata. */
export function parseDockerfileExposedPorts(text: string): string[] {
  const ports = new Set<string>();
  let stage = false;
  let unknown = false;
  let continued = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^#\s*escape\s*=\s*`/i.test(trimmed)) return [];
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/\\\s*$/.test(line)) {
      continued += line.replace(/\\\s*$/, "") + " ";
      continue;
    }
    const instruction = (continued + line).trim();
    continued = "";
    // A heredoc can contain apparent FROM/EXPOSE lines; leave it to the built image.
    if (instruction.includes("<<")) return [];
    const match = instruction.match(/^(\w+)(?:\s+(.*))?$/);
    if (!match) continue;
    const command = match[1].toUpperCase();
    if (command === "FROM") {
      stage = true;
      unknown = false;
      ports.clear();
    } else if (stage && command === "EXPOSE") {
      for (const value of (match[2] ?? "").trim().split(/\s+/)) {
        const port = value.match(/^(\d+)(?:\/(tcp|udp))?$/i);
        if (!port || Number(port[1]) < 1 || Number(port[1]) > 65535) {
          unknown = true;
        } else {
          ports.add(`${Number(port[1])}/${(port[2] ?? "tcp").toLowerCase()}`);
        }
      }
    }
  }
  return stage && !unknown && !continued ? [...ports] : [];
}

function relativePath(value: string): string[] | null {
  if (!value || /[\\\x00-\x1f\x7f$?#%]/.test(value)) return null;
  const parts = value.split("/");
  return parts.some((part) => !part || part === "." || part === "..") ? null : parts;
}

function rawDockerfileUrl(source: RepoSource): string | null {
  try {
    if (/[\\\s$?#]/.test(source.repoUrl)) return null;
    const url = new URL(source.repoUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    if (!["github.com", "gitlab.com", "bitbucket.org"].includes(url.hostname)) return null;
    // Check the original path too: URL normalizes literal and encoded dot segments.
    const originalPath = source.repoUrl.slice(source.repoUrl.indexOf("/", "https://".length) + 1);
    const repo = relativePath(decodeURIComponent(originalPath.replace(/\/$/, "")));
    if (!repo || repo.length < 2 || repo.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) return null;
    if (url.hostname !== "gitlab.com" && repo.length !== 2) return null;
    repo[repo.length - 1] = repo[repo.length - 1].replace(/\.git$/, "");
    if (!repo[repo.length - 1] || repo.some((part) => part === "." || part === ".." || part === "-")) return null;
    if (!relativePath(source.branch) || /\s/.test(source.branch)) return null;
    const directory = source.subdirectory ? relativePath(source.subdirectory) : [];
    const dockerfile = relativePath(source.dockerfile || "Dockerfile");
    if (!directory || !dockerfile) return null;
    const repository = repo.map(encodeURIComponent).join("/");
    const branch = encodeURIComponent(source.branch);
    const path = [...directory, ...dockerfile].map(encodeURIComponent).join("/");
    switch (url.hostname) {
      case "github.com": return `https://raw.githubusercontent.com/${repository}/${branch}/${path}`;
      case "gitlab.com": return `https://gitlab.com/${repository}/-/raw/${branch}/${path}`;
      case "bitbucket.org": return `https://bitbucket.org/${repository}/raw/${branch}/${path}`;
      default: return null;
    }
  } catch {
    return null;
  }
}

/** A bounded public-file lookup; unavailable or ambiguous sources use post-build detection. */
export async function fetchRepoExposedPorts(source: RepoSource): Promise<string[]> {
  const url = rawDockerfileUrl(source);
  if (!url) return [];
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async (): Promise<string[]> => {
    const response = await fetch(url, {
      cache: "no-store", redirect: "error", credentials: "omit", signal: controller.signal,
    });
    reader = response.body?.getReader();
    if (controller.signal.aborted) {
      void reader?.cancel().catch(() => {});
      return [];
    }
    if (!response.ok || !reader ||
      Number(response.headers.get("content-length")) > DOCKERFILE_MAX_BYTES) return [];
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let text = "";
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return parseDockerfileExposedPorts(text + decoder.decode());
      size += value.byteLength;
      if (size > DOCKERFILE_MAX_BYTES) return [];
      text += decoder.decode(value, { stream: true });
    }
    return [];
  };
  try {
    return await Promise.race([
      read(),
      new Promise<string[]>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve([]); }, DOCKERFILE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
