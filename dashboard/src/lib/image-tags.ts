import "server-only";

import { parseImageRef, sortImageTags, type ImageTag } from "./image-ref";

export interface ImageTagsResult {
  tags: ImageTag[];
  available: boolean;
}

const TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 100;
const TAG_LIMIT = 100;
const BODY_LIMIT = 1024 * 1024;
const cache = new Map<string, { expires: number; result: Promise<ImageTagsResult> }>();
const unavailable = (): ImageTagsResult => ({ tags: [], available: false });
const pathSegment = /^[a-z0-9]+(?:[._-]+[a-z0-9]+)*$/;
const tagName = /^[\w][\w.-]{0,127}$/;

async function readBody(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > BODY_LIMIT || !response.body) {
    throw new Error("Tags unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) throw new Error("Tags unavailable");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fetchTags(namespace: string, repository: string): Promise<ImageTagsResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // The host is fixed, path segments validated, and redirects forbidden. Never
    // use a registry-provided next URL or send Docker/Dokploy credentials here.
    const url = new URL(`https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags`);
    url.searchParams.set("page_size", String(TAG_LIMIT));
    url.searchParams.set("ordering", "last_updated");
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return unavailable();
    }
    const body = await readBody(response);
    if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results)) {
      return unavailable();
    }
    const tags: ImageTag[] = [];
    for (const item of body.results.slice(0, TAG_LIMIT)) {
      if (!item || typeof item !== "object" || typeof item.name !== "string" || !tagName.test(item.name)) continue;
      const pushed = item.tag_last_pushed;
      tags.push({
        name: item.name,
        lastPushed: typeof pushed === "string" && Number.isFinite(Date.parse(pushed)) ? pushed : null,
      });
    }
    return { tags: sortImageTags(tags), available: true };
  } catch {
    // Private repositories, rate limits, malformed responses and network errors
    // all have the same result. Editing an image never depends on this lookup.
    return unavailable();
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/** Recent public Docker Hub tags; all other registries remain free-text only. */
export async function getImageTags(image: string): Promise<ImageTagsResult> {
  if (image.length > 1024) return unavailable();
  const ref = parseImageRef(image);
  if (!ref || ref.registry !== "registry-1.docker.io" ||
      !pathSegment.test(ref.namespace) || !pathSegment.test(ref.repository)) {
    return unavailable();
  }
  const key = `${ref.namespace}/${ref.repository}`;
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && entry.expires > now) return entry.result;
  for (const [name, value] of cache) {
    if (value.expires <= now) cache.delete(name);
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  const result = fetchTags(ref.namespace, ref.repository);
  cache.set(key, { expires: now + CACHE_TTL_MS, result });
  return result;
}
