import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn<typeof fetch>();
let getImageTags: typeof import("./image-tags").getImageTags;
const response = (results: unknown[] = []) => Response.json({ results });

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  ({ getImageTags } = await import("./image-tags"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("getImageTags", () => {
  it("uses only the fixed anonymous Docker Hub endpoint and sorts recent tags", async () => {
    fetchMock.mockResolvedValue(response([
      { name: "old", tag_last_pushed: "2025-01-01T00:00:00Z" },
      { name: "latest", tag_last_pushed: "2026-01-01T00:00:00Z" },
      { name: "no-date", tag_last_pushed: "invalid" },
      { name: "bad tag" },
    ]));

    expect(await getImageTags("nginx:stable")).toEqual({
      available: true,
      tags: [
        { name: "latest", lastPushed: "2026-01-01T00:00:00Z" },
        { name: "old", lastPushed: "2025-01-01T00:00:00Z" },
        { name: "no-date", lastPushed: null },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://hub.docker.com/v2/repositories/library/nginx/tags?page_size=100&ordering=last_updated");
    expect(init).toEqual({
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it.each(["docker.io", "index.docker.io", "registry-1.docker.io", "hub.docker.com"])(
    "normalizes the %s alias without using it as the request host",
    async (host) => {
      fetchMock.mockResolvedValue(response());
      await getImageTags(`${host}/traefik/whoami:v1`);
      expect(String(fetchMock.mock.calls[0][0])).toBe("https://hub.docker.com/v2/repositories/traefik/whoami/tags?page_size=100&ordering=last_updated");
    },
  );

  it.each([
    "", "https://hub.docker.com/library/nginx", "localhost:3000/nginx", "127.0.0.1/nginx",
    "ghcr.io/org/app:latest", "example.com/team/app", "docker.io:443/library/nginx",
    "docker.io/library/../nginx", "docker.io/library%2fsecret/nginx", "docker.io/team/nested/app",
    "docker.io/library/nginx?secret=value", "x".repeat(1025),
  ])("does not fetch unsupported or invalid input %s", async (image) => {
    expect(await getImageTags(image)).toEqual({ tags: [], available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches and shares a lookup across tags, aliases, and concurrent callers", async () => {
    fetchMock.mockResolvedValue(response([{ name: "latest" }]));
    const results = await Promise.all([
      getImageTags("nginx:stable"),
      getImageTags("docker.io/library/nginx:latest"),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("expires the cache after one minute", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => response());
    await getImageTags("nginx");
    await vi.advanceTimersByTimeAsync(60_000);
    await getImageTags("nginx");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds the cache to 100 repositories", async () => {
    fetchMock.mockImplementation(async () => response());
    for (let i = 0; i <= 100; i++) await getImageTags(`user/repo${i}`);
    await getImageTags("user/repo0");
    expect(fetchMock).toHaveBeenCalledTimes(102);
  });

  it.each([401, 403, 404, 429, 500])("returns and caches generic unavailability for HTTP %s", async (status) => {
    fetchMock.mockResolvedValue(new Response("internal error details", { status }));
    expect(await getImageTags("user/private")).toEqual({ tags: [], available: false });
    expect(await getImageTags("user/private:other")).toEqual({ tags: [], available: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a generic result on network errors or refused redirects", async () => {
    fetchMock.mockRejectedValue(new Error("private registry details"));
    expect(await getImageTags("nginx")).toEqual({ tags: [], available: false });
  });

  it("aborts a slow request after three seconds", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const result = getImageTags("nginx");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toEqual({ tags: [], available: false });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it.each(["not json", "{}", '{"results":null}'])("handles malformed responses: %s", async (body) => {
    fetchMock.mockResolvedValue(new Response(body));
    expect(await getImageTags("nginx")).toEqual({ tags: [], available: false });
  });

  it("rejects an oversized response even without a content-length header", async () => {
    fetchMock.mockResolvedValue(new Response(" ".repeat(1024 * 1024 + 1)));
    expect(await getImageTags("nginx")).toEqual({ tags: [], available: false });
  });

  it("rejects responses advertised over the body limit", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { headers: { "content-length": "1048577" } }));
    expect(await getImageTags("nginx")).toEqual({ tags: [], available: false });
  });

  it("caps returned tags and does not follow response pagination URLs", async () => {
    fetchMock.mockResolvedValue(Response.json({
      next: "http://127.0.0.1/internal",
      results: Array.from({ length: 101 }, (_, i) => ({ name: `v${i}` })),
    }));
    expect((await getImageTags("nginx")).tags).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
