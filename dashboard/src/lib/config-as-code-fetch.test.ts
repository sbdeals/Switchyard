import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicRepoConfig } from "./config-as-code-fetch";

const REPOSITORY = "https://github.com/example/demo";
const RAW = "https://raw.githubusercontent.com/example/demo";

function mockFetch(...responses: Response[]) {
  const fetcher = vi.fn<typeof fetch>();
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  return fetcher;
}

function missing() {
  return new Response("Not Found", { status: 404 });
}

afterEach(() => vi.useRealTimers());

describe("fetchPublicRepoConfig", () => {
  it("reads the preferred file without credentials, redirects, or caching", async () => {
    const fetcher = mockFetch(new Response('{"build":{"builder":"NIXPACKS"}}'));
    const result = await fetchPublicRepoConfig(REPOSITORY, undefined, fetcher);
    expect(result?.file).toBe("switchyard.json");
    expect(result?.errors).toEqual([]);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${RAW}/main/switchyard.json`, {
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([REPOSITORY, `${REPOSITORY}/`, `${REPOSITORY}.git`, `${REPOSITORY}.git/`])(
    "accepts a GitHub repository root: %s",
    async (repoUrl) => {
      const fetcher = mockFetch(new Response("{}"));
      await fetchPublicRepoConfig(repoUrl, "main", fetcher);
      expect(fetcher.mock.calls[0][0]).toBe(`${RAW}/main/switchyard.json`);
    },
  );

  it.each([
    "http://github.com/example/demo",
    "https://github.example.com/example/demo",
    "https://raw.githubusercontent.com/example/demo",
    "https://github.com.evil.test/example/demo",
    "https://github.com@evil.test/example/demo",
    "https://user:password@github.com/example/demo",
    "https://github.com:443/example/demo",
    `${REPOSITORY}?token=not-a-real-token`,
    `${REPOSITORY}#main`,
    `${REPOSITORY}/tree/main`,
    `${REPOSITORY}/../other`,
    "https://github.com/example/%2e%2e",
    "https://github.com/example%2fother/demo",
    "https://github.com/example/..",
    "https://github.com/example/.git",
    "https://github.com/example\\demo",
    ` ${REPOSITORY}`,
    `${REPOSITORY}\n`,
    `${REPOSITORY}\r`,
    "",
  ])("rejects unsafe or non-root URL %s before fetching", async (repoUrl) => {
    const fetcher = mockFetch();
    await expect(fetchPublicRepoConfig(repoUrl, "main", fetcher)).rejects.toThrow("public GitHub repository URL");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("encodes branch slashes and special characters as one URL segment", async () => {
    const fetcher = mockFetch(new Response("{}"));
    await fetchPublicRepoConfig(REPOSITORY, "feature/café#1+ready", fetcher);
    expect(fetcher.mock.calls[0][0]).toBe(`${RAW}/feature%2Fcaf%C3%A9%231%2Bready/switchyard.json`);
  });

  it.each(["", "/main", "main/", "feature//one", "../main", "main..old", "main branch", "main\n", "main?x=1", "main\\other", ".main", "refs/.hidden/x", "main.lock", "main.", "@", "main@{1}"])(
    "rejects invalid branch %s before fetching",
    async (branch) => {
      const fetcher = mockFetch();
      await expect(fetchPublicRepoConfig(REPOSITORY, branch, fetcher)).rejects.toThrow("valid Git branch");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("falls back to railway.json only when switchyard.json is missing", async () => {
    const fetcher = mockFetch(missing(), new Response('{"deploy":{"startCommand":"node server.js"}}'));
    const result = await fetchPublicRepoConfig(REPOSITORY, "main", fetcher);
    expect(result?.file).toBe("railway.json");
    expect(result?.errors).toEqual([]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${RAW}/main/switchyard.json`, `${RAW}/main/railway.json`,
    ]);
  });

  it("falls back to TOML after both JSON files are missing", async () => {
    const fetcher = mockFetch(missing(), missing(), new Response('[deploy]\nstartCommand = "node server.js"'));
    const result = await fetchPublicRepoConfig(REPOSITORY, "main", fetcher);
    expect(result?.file).toBe("railway.toml");
    expect(result?.errors).toEqual([]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${RAW}/main/switchyard.json`, `${RAW}/main/railway.json`, `${RAW}/main/railway.toml`,
    ]);
  });

  it("returns null when all supported files are missing", async () => {
    const fetcher = mockFetch(missing(), missing(), missing());
    await expect(fetchPublicRepoConfig(REPOSITORY, "main", fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each(["not JSON", '{"build":{"builder":false}}'])(
    "returns an invalid preferred file without falling back: %s",
    async (content) => {
      const fetcher = mockFetch(new Response(content));
      const result = await fetchPublicRepoConfig(REPOSITORY, "main", fetcher);
      expect(result?.file).toBe("switchyard.json");
      expect(result?.errors.length).toBeGreaterThan(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("does not fall back to TOML after an invalid railway.json", async () => {
    const fetcher = mockFetch(missing(), new Response("not JSON"));
    const result = await fetchPublicRepoConfig(REPOSITORY, "main", fetcher);
    expect(result?.file).toBe("railway.json");
    expect(result?.errors.length).toBeGreaterThan(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([301, 403, 429, 500])("does not fall back on HTTP %i", async (status) => {
    const fetcher = mockFetch(new Response("error", { status }));
    await expect(fetchPublicRepoConfig(REPOSITORY, "main", fetcher)).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not fall back after network errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Network failed"));
    await expect(fetchPublicRepoConfig(REPOSITORY, "main", fetcher)).rejects.toThrow("Network failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a declared oversized body before reading it", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetcher = mockFetch(new Response(body, { headers: { "content-length": "65537" } }));
    await expect(fetchPublicRepoConfig(REPOSITORY, "main", fetcher)).rejects.toThrow("64 KiB");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "1"])("bounds streamed bytes even with content-length %s", async (contentLength) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024));
        controller.enqueue(new Uint8Array(32 * 1024 + 1));
      },
      cancel,
    });
    const headers = contentLength ? { "content-length": contentLength } : undefined;
    const fetcher = mockFetch(new Response(body, { headers }));
    await expect(fetchPublicRepoConfig(REPOSITORY, "main", fetcher)).rejects.toThrow("64 KiB");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("accepts exactly 64 KiB", async () => {
    const fetcher = mockFetch(new Response(`{}${" ".repeat(64 * 1024 - 2)}`));
    const result = await fetchPublicRepoConfig(REPOSITORY, "main", fetcher);
    expect(result?.errors).toEqual([]);
  });

  it("decodes UTF-8 split across stream chunks", async () => {
    const bytes = new TextEncoder().encode('{"deploy":{"startCommand":"echo café"}}');
    const split = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const result = await fetchPublicRepoConfig(REPOSITORY, "main", mockFetch(new Response(body)));
    expect(result?.errors).toEqual([]);
    expect(result?.config.deploy?.startCommand).toBe("echo café");
  });

  it("rejects malformed UTF-8 instead of silently changing config values", async () => {
    const fetcher = mockFetch(new Response(new Uint8Array([0xff])));
    await expect(fetchPublicRepoConfig(REPOSITORY, "main", fetcher)).rejects.toThrow();
  });

  it("aborts a stalled fetch after ten seconds and clears its timer", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
    }));
    const pending = fetchPublicRepoConfig(REPOSITORY, "main", fetcher);
    const assertion = expect(pending).rejects.toThrow("Timed out reading switchyard.json");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("clears timers after successful requests", async () => {
    vi.useFakeTimers();
    await fetchPublicRepoConfig(REPOSITORY, "main", mockFetch(new Response("{}")));
    expect(vi.getTimerCount()).toBe(0);
  });
});
