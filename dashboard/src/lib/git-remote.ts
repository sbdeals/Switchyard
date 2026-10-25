import "server-only";

const REFS_MAX_BYTES = 1024 * 1024;
const COMMIT_MAX_BYTES = 256 * 1024;

function validBranch(branch: string): boolean {
  return !!branch && branch.length <= 1024 &&
    !/[\x00-\x20\x7f~^:?*\[\\]/.test(branch) &&
    !branch.includes("..") && !branch.includes("@{") && !branch.endsWith(".") &&
    branch.split("/").every((part) => !!part && !part.startsWith(".") && !part.endsWith(".lock"));
}

/** Read a v0 smart-HTTP advertisement; packet lengths count bytes, not characters. */
export function parseGitRemoteRefs(input: Uint8Array | string, branch: string): string | null {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (!validBranch(branch) || bytes.byteLength > REFS_MAX_BYTES) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  let packet = 0;
  let sha: string | null = null;
  let finished = false;
  try {
    while (offset < bytes.length) {
      if (finished || offset + 4 > bytes.length) return null;
      const prefix = decoder.decode(bytes.subarray(offset, offset + 4));
      if (!/^[0-9a-f]{4}$/i.test(prefix)) return null;
      const length = parseInt(prefix, 16);
      if (length === 0) {
        if (packet === 1) packet++;
        else if (packet > 1) finished = true;
        else return null;
        offset += 4;
        continue;
      }
      if (length < 4 || length > 65520 || offset + length > bytes.length || packet === 1) return null;
      const line = decoder.decode(bytes.subarray(offset + 4, offset + length)).replace(/\n$/, "");
      if (packet === 0) {
        if (line !== "# service=git-upload-pack") return null;
      } else {
        const ref = line.split("\0", 1)[0].match(/^([a-f0-9]{40}|[a-f0-9]{64}) (.+)$/i);
        if (ref?.[2] === `refs/heads/${branch}`) {
          if (/^0+$/.test(ref[1]) || (sha && sha !== ref[1].toLowerCase())) return null;
          sha = ref[1].toLowerCase();
        }
      }
      packet++;
      offset += length;
    }
    return finished ? sha : null;
  } catch {
    return null;
  }
}

function publicRepoUrl(repoUrl: string): URL | null {
  try {
    if (/[\s\\]/.test(repoUrl)) return null;
    const url = new URL(repoUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname === "/") return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (!url.pathname.endsWith(".git")) url.pathname += ".git";
    return url;
  } catch {
    return null;
  }
}

/** Static Git HTTP servers return update-server-info's plain refs at the same URL. */
export function parseDumbGitRefs(bytes: Uint8Array, branch: string): string | null {
  if (!validBranch(branch) || bytes.byteLength > REFS_MAX_BYTES) return null;
  try {
    let sha: string | null = null;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    for (const line of text.split("\n")) {
      if (!line) continue;
      const ref = line.match(/^([a-f0-9]{40}|[a-f0-9]{64})\t(refs\/[^\x00-\x20]+)$/i);
      if (!ref) return null;
      if (ref[2] === `refs/heads/${branch}`) {
        if (/^0+$/.test(ref[1]) || (sha && sha !== ref[1].toLowerCase())) return null;
        sha = ref[1].toLowerCase();
      }
    }
    return sha;
  } catch { return null; }
}

async function boundedGet(url: URL, maxBytes: number, timeoutMs: number): Promise<Uint8Array | null> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async (): Promise<Uint8Array | null> => {
    const response = await fetch(url.toString(), {
      cache: "no-store", redirect: "error", credentials: "omit", signal: controller.signal,
      headers: { Accept: "*/*" },
    });
    reader = response.body?.getReader();
    if (controller.signal.aborted) {
      void reader?.cancel().catch(() => {});
      return null;
    }
    if (!response.ok || !reader || Number(response.headers.get("content-length")) > maxBytes) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return body;
      }
      size += value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(value);
    }
    return null;
  };
  try {
    return await Promise.race([
      read(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

/** Best-effort public metadata only: at most two requests and three seconds total. */
export async function resolveRepoCommit(repoUrl: string, branch: string): Promise<{ sha: string; headline?: string } | null> {
  const url = publicRepoUrl(repoUrl);
  if (!url || !validBranch(branch)) return null;
  const refsUrl = new URL(url);
  refsUrl.pathname += "/info/refs";
  refsUrl.search = "service=git-upload-pack";
  const refs = await boundedGet(refsUrl, REFS_MAX_BYTES, 2000);
  const sha = refs && (parseGitRemoteRefs(refs, branch) ?? parseDumbGitRefs(refs, branch));
  if (!sha) return null;
  const result: { sha: string; headline?: string } = { sha };
  const github = url.pathname.match(/^\/([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)\.git$/);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || !github) return result;
  const commitUrl = new URL(`https://api.github.com/repos/${github[1]}/${github[2]}/commits/${sha}`);
  const commit = await boundedGet(commitUrl, COMMIT_MAX_BYTES, 1000);
  if (commit) {
    try {
      const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(commit));
      if (data.sha === sha && typeof data.commit?.message === "string") {
        const headline = data.commit.message.split(/\r?\n/, 1)[0]
          .replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 200);
        if (headline) result.headline = headline;
      }
    } catch { /* A missing headline must not prevent deployment. */ }
  }
  return result;
}
