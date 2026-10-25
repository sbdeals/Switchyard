import "server-only";
import { djangoWsgiPath, type RepoBuildFiles } from "./build-plan";

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

function rawFileUrl(source: RepoSource, file: string): string | null {
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
    const parts = relativePath(file);
    if (!directory || !parts) return null;
    const repository = repo.map(encodeURIComponent).join("/");
    const branch = encodeURIComponent(source.branch);
    const path = [...directory, ...parts].map(encodeURIComponent).join("/");
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

type PublicFile = { status: "found"; text: string } | { status: "missing" | "unavailable" };

/** No credentials or redirects; both fetch and body reads share a hard deadline. */
async function fetchPublicFile(url: string, contents: boolean, deadline: number): Promise<PublicFile> {
  const unavailable: PublicFile = { status: "unavailable" };
  if (Date.now() >= deadline) return unavailable;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async (): Promise<PublicFile> => {
    const response = await fetch(url, {
      cache: "no-store", redirect: "error", credentials: "omit", signal: controller.signal,
    });
    reader = response.body?.getReader();
    if (controller.signal.aborted) {
      void reader?.cancel().catch(() => {});
      return unavailable;
    }
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) return unavailable;
    // Lockfiles and entry points only need a presence check, even if very large.
    if (!contents) return { status: "found", text: "" };
    if (!reader || Number(response.headers.get("content-length")) > DOCKERFILE_MAX_BYTES) return unavailable;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let text = "";
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return { status: "found", text: text + decoder.decode() };
      size += value.byteLength;
      if (size > DOCKERFILE_MAX_BYTES) return unavailable;
      text += decoder.decode(value, { stream: true });
    }
    return unavailable;
  };
  try {
    return await Promise.race([
      read(),
      new Promise<PublicFile>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(unavailable); }, Math.max(1, deadline - Date.now()));
      }),
    ]);
  } catch {
    return unavailable;
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

/** A bounded public-file lookup; unavailable or ambiguous sources use post-build detection. */
export async function fetchRepoExposedPorts(source: RepoSource): Promise<string[]> {
  const url = rawFileUrl(source, source.dockerfile || "Dockerfile");
  if (!url) return [];
  const file = await fetchPublicFile(url, true, Date.now() + DOCKERFILE_TIMEOUT_MS);
  return file.status === "found" ? parseDockerfileExposedPorts(file.text) : [];
}

const MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "Pipfile", "go.mod", "Procfile", "manage.py"];
const PRESENCE_ONLY = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Pipfile.lock", "server.js", "index.js", "app.py", "main.py", "index.html"];

/**
 * Probe a fixed set of public paths, not an unbounded tree/clone. All requests
 * share a five-second deadline. Unavailable discovery preserves Dockerfile
 * deployment; only confirmed absence is used for automatic build detection.
 */
export async function fetchRepoBuildFiles(source: RepoSource): Promise<RepoBuildFiles | null> {
  // An explicitly selected Dockerfile remains authoritative, even if unavailable.
  if (source.dockerfile && source.dockerfile !== "Dockerfile") return null;
  const dockerfileUrl = rawFileUrl(source, "Dockerfile");
  if (!dockerfileUrl) return null;
  const deadline = Date.now() + Math.min(DOCKERFILE_TIMEOUT_MS, 5_000);
  const dockerfile = await fetchPublicFile(dockerfileUrl, false, deadline);
  if (dockerfile.status === "unavailable") return null;
  if (dockerfile.status === "found") return { files: ["Dockerfile"], contents: {} };
  const paths = [...MANIFESTS, ...PRESENCE_ONLY];
  const results = await Promise.all(paths.map((path) =>
    fetchPublicFile(rawFileUrl(source, path)!, MANIFESTS.includes(path), deadline)));
  if (results.some((result) => result.status === "unavailable")) return null;
  const found: RepoBuildFiles = { files: [], contents: {} };
  results.forEach((result, i) => {
    if (result.status === "found") {
      found.files.push(paths[i]);
      found.contents[paths[i]] = result.text;
    }
  });
  const wsgi = djangoWsgiPath(found.contents["manage.py"] ?? "");
  if (wsgi) {
    const file = await fetchPublicFile(rawFileUrl(source, wsgi)!, false, deadline);
    if (file.status === "unavailable") return null;
    if (file.status === "found") found.files.push(wsgi);
  }
  return found;
}
