import "server-only";
import { parseImageReference, type ImageReference } from "./image-ref";

export interface RegistryImageDigest {
  digest: string | null;
  reason: string | null;
  checkedAt: string | null;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

function responseReason(status: number): string {
  if (status === 401 || status === 403) return "This image requires registry authentication or is not public.";
  if (status === 429) return "The registry rate limit was reached. Try again later.";
  if (status === 404) return "The image or tag was not found in the public registry.";
  return "The registry could not be reached. Try again later.";
}

/** Anonymous registry reads only. Endpoints are fixed; redirects cannot send tokens elsewhere. */
export function createRegistryLookup(fetcher: Fetcher = fetch, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { result: RegistryImageDigest; expiresAt: number }>();
  const inFlight = new Map<string, Promise<RegistryImageDigest>>();
  const waiting: Array<() => void> = [];
  let active = 0;

  function result(digest: string | null, reason: string | null, checked = true): RegistryImageDigest {
    return { digest, reason, checkedAt: checked ? new Date(now()).toISOString() : null };
  }

  async function readRegistry(ref: ImageReference): Promise<RegistryImageDigest> {
    const controller = new AbortController();
    const request: RequestInit = {
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    };
    const hub = ref.registry === "docker.io";
    const query = new URLSearchParams({
      service: hub ? "registry.docker.io" : "ghcr.io",
      scope: `repository:${ref.repository}:pull`,
    });
    const tokenUrl = `${hub ? "https://auth.docker.io/token" : "https://ghcr.io/token"}?${query}`;
    const registryUrl = hub ? "https://registry-1.docker.io" : "https://ghcr.io";
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        (async () => {
          const tokenResponse = await fetcher(tokenUrl, { ...request, method: "GET" });
          if (!tokenResponse.ok) {
            await tokenResponse.body?.cancel();
            return result(null, responseReason(tokenResponse.status));
          }
          const body: unknown = await tokenResponse.json();
          const token = body && typeof body === "object"
            ? (body as { token?: unknown; access_token?: unknown }).token ?? (body as { access_token?: unknown }).access_token
            : null;
          if (typeof token !== "string" || !token || /[\r\n]/.test(token)) return result(null, "The registry did not provide an anonymous access token.");
          controller.signal.throwIfAborted();
          const manifest = await fetcher(`${registryUrl}/v2/${ref.repository}/manifests/${ref.tag}`, {
            ...request,
            method: "HEAD",
            headers: { Accept: MANIFEST_ACCEPT, Authorization: `Bearer ${token}` },
          });
          if (!manifest.ok) return result(null, responseReason(manifest.status));
          // This is the index/list digest, not an architecture-specific child or image config ID.
          const digest = manifest.headers.get("Docker-Content-Digest");
          if (!digest || !/^sha256:[a-fA-F0-9]{64}$/.test(digest)) return result(null, "The registry did not return a valid image digest.");
          return result(digest.toLowerCase(), null);
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Registry lookup timed out"));
          }, TIMEOUT_MS);
        }),
      ]);
    } catch {
      return result(null, controller.signal.aborted
        ? "The registry check timed out. Try again later."
        : "The registry could not be reached. Try again later.");
    } finally {
      clearTimeout(timer);
    }
  }

  async function withSlot(ref: ImageReference): Promise<RegistryImageDigest> {
    if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await readRegistry(ref);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }

  return function lookupRegistryImage(input: string): Promise<RegistryImageDigest> {
    const ref = parseImageReference(input);
    if (!ref) return Promise.resolve(result(null, "The configured image reference is invalid.", false));
    if (ref.digest) return Promise.resolve(result(null, "This image is pinned by digest; its tag is not checked for updates.", false));
    if (ref.registry !== "docker.io" && ref.registry !== "ghcr.io") return Promise.resolve(result(null, "Only public Docker Hub and ghcr.io images can be checked.", false));
    const cached = cache.get(ref.normalized);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached.result);
    const pending = inFlight.get(ref.normalized);
    if (pending) return pending;
    const lookup = withSlot(ref).then((value) => {
      // Keep the process cache bounded, including negative lookups.
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(ref.normalized, { result: value, expiresAt: now() + CACHE_MS });
      return value;
    }).finally(() => inFlight.delete(ref.normalized));
    inFlight.set(ref.normalized, lookup);
    return lookup;
  };
}

export const lookupRegistryImage = createRegistryLookup();
