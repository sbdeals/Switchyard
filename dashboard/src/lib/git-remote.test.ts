import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseDumbGitRefs, parseGitRemoteRefs, resolveRepoCommit } from "./git-remote";

const sha = "a1b2c3d" + "0".repeat(33);
const otherSha = "b".repeat(40);
const packet = (line: string) => (new TextEncoder().encode(line).length + 4).toString(16).padStart(4, "0") + line;
const advertisement = (lines = [`${sha} refs/heads/main\0multi_ack side-band-64k\n`]) =>
  packet("# service=git-upload-pack\n") + "0000" + lines.map(packet).join("") + "0000";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("static Git HTTP refs", () => {
  const bytes = (value: string) => new TextEncoder().encode(value);
  it("matches only the exact branch in update-server-info output", () => {
    const refs = bytes(`${otherSha}\trefs/tags/main\n${sha}\trefs/heads/main\n`);
    expect(parseDumbGitRefs(refs, "main")).toBe(sha);
    expect(parseDumbGitRefs(refs, "other")).toBeNull();
  });
  it.each([`<html>${sha}</html>`, `${sha}\trefs/heads/main\ntruncated`,
    `${"0".repeat(40)}\trefs/heads/main\n`, `${sha}\trefs/heads/main\n${otherSha}\trefs/heads/main\n`])(
    "rejects invalid or ambiguous static refs", (value) => {
      expect(parseDumbGitRefs(bytes(value), "main")).toBeNull();
    },
  );
  it("resolves a dumb HTTP server using the same bounded request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`${sha}\trefs/heads/main\n`)));
    expect(await resolveRepoCommit("http://127.0.0.1:8765/f-hook.git", "main")).toEqual({ sha });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("parseGitRemoteRefs", () => {
  it("reads capability-bearing packets and the exact branch rather than HEAD, tags, or prefixes", () => {
    const refs = advertisement([
      `${otherSha} HEAD\0symref=HEAD:refs/heads/other\n`,
      `${otherSha} refs/tags/main\n`,
      `${otherSha} refs/heads/main-old\n`,
      `${sha} refs/heads/main\n`,
    ]);
    expect(parseGitRemoteRefs(refs, "main")).toBe(sha);
    expect(parseGitRemoteRefs(refs, "missing")).toBeNull();
  });

  it("counts UTF-8 bytes, permits slash branches and optional newlines, and supports SHA-256", () => {
    const longSha = "c".repeat(64);
    expect(parseGitRemoteRefs(advertisement([`${longSha} refs/heads/feature/é`]), "feature/é")).toBe(longSha);
  });

  it.each([
    "", "000", "zzzz", "0001", "0002", "0003", "0004", "ffff" + "x".repeat(65531),
    packet("# service=git-receive-pack\n") + "0000" + packet(`${sha} refs/heads/main\n`) + "0000",
    packet("# service=git-upload-pack\n") + packet(`${sha} refs/heads/main\n`) + "0000",
    advertisement().slice(0, -1), advertisement().slice(0, -4), advertisement() + "0000",
    advertisement([`${"0".repeat(40)} refs/heads/main\n`]),
    advertisement([`${sha} refs/heads/main\n`, `${otherSha} refs/heads/main\n`]),
    advertisement(["abcdef refs/heads/main\n"]),
    `${sha}\trefs/heads/main\n`,
  ])("rejects malformed, incomplete, ambiguous, or non-smart advertisements (%#)", (refs) => {
    expect(parseGitRemoteRefs(refs, "main")).toBeNull();
  });

  it("rejects invalid UTF-8 and advertisements over the byte limit", () => {
    const bytes = new TextEncoder().encode(advertisement());
    bytes[4] = 255;
    expect(parseGitRemoteRefs(bytes, "main")).toBeNull();
    expect(parseGitRemoteRefs(new Uint8Array(1024 * 1024 + 1), "main")).toBeNull();
  });

  it.each(["", "main\n", "../main", "main..old", "main.lock", "a//b", "a@{b", "a?b", "/main", "main/"])(
    "rejects invalid branch names (%#)", (branch) => {
      expect(parseGitRemoteRefs(advertisement(), branch)).toBeNull();
    },
  );
});

describe("resolveRepoCommit", () => {
  it("reads public GitHub refs, then retrieves the matching commit headline without credentials", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(advertisement()))
      .mockResolvedValueOnce(Response.json({ sha, commit: { message: "Fix header\n\nLonger explanation" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await resolveRepoCommit("https://github.com/acme/site/", "main"))
      .toEqual({ sha, headline: "Fix header" });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://github.com/acme/site.git/info/refs?service=git-upload-pack",
      `https://api.github.com/repos/acme/site/commits/${sha}`,
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
      expect(options.headers).not.toHaveProperty("Authorization");
      expect(options.headers).not.toHaveProperty("Cookie");
    }
  });

  it("allows a local HTTP Git service and preserves an existing .git suffix", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(advertisement()));
    vi.stubGlobal("fetch", fetch);
    expect(await resolveRepoCommit("http://127.0.0.1:8123/site.git", "main")).toEqual({ sha });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "http://127.0.0.1:8123/site.git/info/refs?service=git-upload-pack", expect.any(Object),
    );
  });

  it.each([
    "git@github.com:acme/site", "file:///tmp/site", "ftp://example.com/site",
    "https://user:pass@example.com/site", "https://user@example.com/site",
    "https://example.com/site?token=private", "https://example.com/site#main",
    "https://example.com/", "https://example.com/site\n", "https://example.com\\site",
  ])("skips invalid or credentialed repo URLs (%#)", async (url) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await resolveRepoCommit(url, "main")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fetch an invalid branch", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await resolveRepoCommit("https://example.com/site", "bad\nbranch")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([403, 404, 429, 500])("fails open on HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status })));
    expect(await resolveRepoCommit("https://example.com/site", "main")).toBeNull();
  });

  it("fails open on network errors and missing branches", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response(advertisement()));
    vi.stubGlobal("fetch", fetch);
    expect(await resolveRepoCommit("https://example.com/site", "main")).toBeNull();
    expect(await resolveRepoCommit("https://example.com/site", "missing")).toBeNull();
  });

  it("enforces both declared and streamed byte limits, cancelling the reader", async () => {
    const cancel = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel,
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(advertisement(), { headers: { "content-length": String(1024 * 1024 + 1) } }))
      .mockResolvedValueOnce(new Response(oversized));
    vi.stubGlobal("fetch", fetch);
    expect(await resolveRepoCommit("https://example.com/site", "main")).toBeNull();
    expect(await resolveRepoCommit("https://example.com/site", "main")).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["fetch", "body"])("bounds a stalled %s even if it ignores the abort signal", async (stage) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(stage === "fetch"
      ? () => new Promise<Response>(() => {})
      : async () => new Response(new ReadableStream({ pull() {}, cancel })));
    vi.stubGlobal("fetch", fetch);
    const result = resolveRepoCommit("https://example.com/site", "main");
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBeNull();
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    if (stage === "body") expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    new Response("rate limit", { status: 429 }),
    new Response("not json"),
    Response.json({ sha: otherSha, commit: { message: "Wrong commit" } }),
    Response.json({ sha, commit: { message: 12 } }),
    Response.json({ sha, commit: { message: "\nNo headline" } }),
    new Response("x".repeat(256 * 1024 + 1)),
  ])("preserves the SHA when GitHub metadata is unavailable or invalid (%#)", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(advertisement())).mockResolvedValueOnce(response));
    expect(await resolveRepoCommit("https://github.com/acme/site.git", "main")).toEqual({ sha });
  });

  it("bounds the optional GitHub request independently and retains the SHA on timeout", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response(advertisement()))
      .mockImplementationOnce(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const result = resolveRepoCommit("https://github.com/acme/site", "main");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ sha });
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it("sanitizes and bounds a headline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(advertisement()))
      .mockResolvedValueOnce(Response.json({ sha, commit: { message: "\tFix\x00 " + "x".repeat(300) + "\r\nbody" } })));
    const result = await resolveRepoCommit("https://github.com/acme/site", "main");
    expect(result?.headline).toHaveLength(200);
    expect(result?.headline).toMatch(/^Fix  x+$/);
  });
});
