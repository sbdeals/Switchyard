import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRegistryLookup } from "./image-registry";

const digest = `sha256:${"a".repeat(64)}`;
const tokenResponse = () => Response.json({ token: "anonymous-token" });
const manifestResponse = () => new Response(null, { headers: { "Docker-Content-Digest": digest } });

afterEach(() => vi.useRealTimers());

describe("registry image lookup", () => {
  it.each([
    ["nginx:alpine", "https://auth.docker.io/token", "registry.docker.io", "library/nginx", "https://registry-1.docker.io"],
    ["ghcr.io/owner/image:alpine", "https://ghcr.io/token", "ghcr.io", "owner/image", "https://ghcr.io"],
  ])("uses anonymous token then manifest HEAD for %s", async (input, auth, service, repository, registry) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(manifestResponse());
    const lookup = createRegistryLookup(fetcher, { now: () => 0 });
    expect(await lookup(input)).toEqual({ digest, reason: null, checkedAt: "1970-01-01T00:00:00.000Z" });
    const [tokenUrl, tokenInit] = fetcher.mock.calls[0];
    expect(String(tokenUrl).split("?")[0]).toBe(auth);
    expect(new URL(String(tokenUrl)).searchParams.get("service")).toBe(service);
    expect(new URL(String(tokenUrl)).searchParams.get("scope")).toBe(`repository:${repository}:pull`);
    expect(tokenInit?.headers).toBeUndefined();
    const [manifestUrl, manifestInit] = fetcher.mock.calls[1];
    expect(manifestUrl).toBe(`${registry}/v2/${repository}/manifests/alpine`);
    expect(manifestInit?.method).toBe("HEAD");
    const headers = new Headers(manifestInit?.headers);
    expect(headers.get("Authorization")).toBe("Bearer anonymous-token");
    expect(headers.get("Accept")).toContain("application/vnd.oci.image.index.v1+json");
    expect(headers.get("Accept")).toContain("application/vnd.docker.distribution.manifest.list.v2+json");
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("accepts access_token token responses", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "anonymous-token" }))
      .mockResolvedValueOnce(manifestResponse());
    expect((await createRegistryLookup(fetcher)("nginx")).digest).toBe(digest);
  });

  it.each([
    [`nginx@${digest}`, "pinned by digest"],
    [`nginx:latest@${digest}`, "pinned by digest"],
    ["registry.example/image", "Only public"],
    ["docker.io:443/library/nginx", "Only public"],
    ["localhost:5000/image", "Only public"],
    ["https://docker.io/nginx", "invalid"],
  ])("skips network for %s", async (input, reason) => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await createRegistryLookup(fetcher)(input);
    expect(result.digest).toBeNull();
    expect(result.reason).toContain(reason);
    expect(result.checkedAt).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, "authentication"], [403, "authentication"], [404, "not found"],
    [429, "rate limit"], [500, "could not be reached"],
  ])("returns unknown for token status %s", async (status, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    const result = await createRegistryLookup(fetcher)("ghcr.io/private/image");
    expect(result.digest).toBeNull();
    expect(result.reason).toContain(reason);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404, 429, 500])("returns unknown for manifest status %s", async (status) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(null, { status }));
    expect((await createRegistryLookup(fetcher)("nginx")).digest).toBeNull();
  });

  it.each([null, "", "sha256:1234", "untrusted digest"])("rejects missing or invalid digest %s", async (header) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(null, { headers: header === null ? {} : { "Docker-Content-Digest": header } }));
    const result = await createRegistryLookup(fetcher)("nginx");
    expect(result.digest).toBeNull();
    expect(result.reason).toContain("valid image digest");
  });

  it("does not follow a redirect or expose network error details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("a sensitive network error"));
    const result = await createRegistryLookup(fetcher)("nginx");
    expect(result.reason).toBe("The registry could not be reached. Try again later.");
  });

  it("caches normalized tags, including failures, for ten minutes", async () => {
    let time = 0;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
    const lookup = createRegistryLookup(fetcher, { now: () => time });
    const first = await lookup("nginx");
    time = 599999;
    expect(await lookup("docker.io/library/nginx:latest")).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    time = 600000;
    expect((await lookup("nginx")).checkedAt).not.toBe(first.checkedAt);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await lookup("nginx:alpine");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("deduplicates inflight checks and runs at most two lookups concurrently", async () => {
    const release: Array<(response: Response) => void> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === "HEAD") return manifestResponse();
      return new Promise<Response>((resolve) => release.push(resolve));
    });
    const lookup = createRegistryLookup(fetcher);
    const first = lookup("nginx:one");
    const same = lookup("docker.io/library/nginx:one");
    const second = lookup("nginx:two");
    const third = lookup("nginx:three");
    expect(same).toBe(first);
    expect(release).toHaveLength(2);
    release[0](tokenResponse());
    await first;
    expect(release).toHaveLength(3);
    release[1](tokenResponse());
    release[2](tokenResponse());
    expect((await Promise.all([second, third])).map((value) => value.digest)).toEqual([digest, digest]);
  });

  it("limits the entire token and manifest exchange to five seconds", async () => {
    vi.useFakeTimers();
    let releaseToken!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseToken = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(() => {}));
    const pending = createRegistryLookup(fetcher)("nginx");
    await vi.advanceTimersByTimeAsync(4000);
    releaseToken(tokenResponse());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).reason).toContain("timed out");
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
  });

  it("does not begin a manifest request if a token resolves after timeout", async () => {
    vi.useFakeTimers();
    let releaseToken!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseToken = resolve; }));
    const pending = createRegistryLookup(fetcher)("nginx");
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).reason).toContain("timed out");
    releaseToken(tokenResponse());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
