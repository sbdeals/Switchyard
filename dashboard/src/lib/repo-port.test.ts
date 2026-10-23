import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseDockerfileExposedPorts } from "./repo-port";

describe("parseDockerfileExposedPorts", () => {
  it("collects all numeric exposed ports and normalizes TCP defaults", () => {
    expect(parseDockerfileExposedPorts("FROM scratch\nEXPOSE 8080 443/tcp 53/udp\nEXPOSE 8080"))
      .toEqual(["8080/tcp", "443/tcp", "53/udp"]);
  });

  it("uses only the final FROM stage", () => {
    expect(parseDockerfileExposedPorts(
      "FROM node AS build\nEXPOSE 3000\nFROM alpine AS runtime\nEXPOSE 8080",
    )).toEqual(["8080/tcp"]);
    expect(parseDockerfileExposedPorts("FROM node AS build\nEXPOSE 3000\nFROM alpine")).toEqual([]);
  });

  it("ignores full-line comments and joins continued instructions", () => {
    expect(parseDockerfileExposedPorts(
      "# EXPOSE 80\r\nFROM alpine\r\n  expose 8080 \\\r\n# ignored within a continuation\r\n  8443/tcp\r\n" +
      "RUN echo ignored \\\r\nEXPOSE 9999\r\n",
    )).toEqual(["8080/tcp", "8443/tcp"]);
  });

  it.each(["$PORT", "${PORT}", "8080 $PORT", "0", "65536", "3.5", "80/sctp", "3000-3001", "8080 # web", ""])(
    "treats unresolved or unsupported EXPOSE %s as unknown for the whole stage", (value) => {
      expect(parseDockerfileExposedPorts(`FROM alpine\nARG PORT=8080\nEXPOSE 443\nEXPOSE ${value}`)).toEqual([]);
    },
  );

  it("allows a numeric final stage even when earlier stages have unresolved ports", () => {
    expect(parseDockerfileExposedPorts(
      "FROM alpine AS build\nARG PORT=3000\nEXPOSE $PORT\nFROM alpine\nARG OTHER=1\nEXPOSE 8080",
    )).toEqual(["8080/tcp"]);
  });

  it.each([
    "EXPOSE 8080",
    "FROM alpine\nEXPOSE 8080 \\",
    "# escape=`\nFROM alpine\nEXPOSE 8080",
    "FROM alpine\nRUN cat <<EOF\nFROM scratch\nEXPOSE 80\nEOF\nEXPOSE 8080",
  ])("returns unknown for incomplete or unsupported Dockerfile syntax", (dockerfile) => {
    expect(parseDockerfileExposedPorts(dockerfile)).toEqual([]);
  });
});

const source = { repoUrl: "https://github.com/team/app", branch: "main" };
let fetchRepoExposedPorts: typeof import("./repo-port").fetchRepoExposedPorts;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("REPO_DOCKERFILE_TIMEOUT_MS", "25");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("FROM alpine\nEXPOSE 8080")));
  ({ fetchRepoExposedPorts } = await import("./repo-port"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchRepoExposedPorts", () => {
  it.each([
    ["https://github.com/team/app.git", "https://raw.githubusercontent.com/team/app/main/Dockerfile"],
    ["https://gitlab.com/team/subgroup/app", "https://gitlab.com/team/subgroup/app/-/raw/main/Dockerfile"],
    ["https://bitbucket.org/team/app/", "https://bitbucket.org/team/app/raw/main/Dockerfile"],
  ])("reads the public Dockerfile for %s", async (repoUrl, rawUrl) => {
    expect(await fetchRepoExposedPorts({ ...source, repoUrl })).toEqual(["8080/tcp"]);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(rawUrl, {
      cache: "no-store", redirect: "error", credentials: "omit", signal: expect.any(AbortSignal),
    });
  });

  it("encodes branches and joins Dockerfile paths relative to the build subdirectory", async () => {
    await fetchRepoExposedPorts({
      ...source, branch: "feature/new-port", subdirectory: "apps/web", dockerfile: "docker/Production Dockerfile",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/team/app/feature%2Fnew-port/apps/web/docker/Production%20Dockerfile",
      expect.any(Object),
    );
  });

  it.each([
    "http://github.com/team/app",
    "https://example.com/team/app",
    "https://github.com.evil.example/team/app",
    "https://user:token@github.com/team/app",
    "https://github.com:8443/team/app",
    "https://github.com/team/app?token=secret",
    "https://github.com/team/app#main",
    "https://github.com/team/../app",
    "https://github.com/team/%2e%2e/app",
    "https://github.com/team/%252e%252e/app",
    "https://github.com/team/...git",
    "https://github.com/team/app/blob/main/Dockerfile",
    "https://gitlab.com/team/app/-/tree/main",
    "https://github.com/team\\app",
    "https://github.com/team/$APP",
  ])("skips unsafe or unrecognized repository URLs without fetching: %s", async (repoUrl) => {
    expect(await fetchRepoExposedPorts({ ...source, repoUrl })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { branch: "../main" },
    { branch: "main?token=secret" },
    { branch: "${BRANCH}" },
    { subdirectory: "../web" },
    { subdirectory: "/apps/web" },
    { subdirectory: "apps/%2e%2e/web" },
    { dockerfile: "../Dockerfile" },
    { dockerfile: "docker\\Dockerfile" },
    { dockerfile: "Dockerfile?token=secret" },
  ])("skips unsafe source paths without fetching: %j", async (patch) => {
    expect(await fetchRepoExposedPorts({ ...source, ...patch })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([403, 404, 500])("falls back when the public file returns HTTP %s", async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response("Unavailable", { status }));
    expect(await fetchRepoExposedPorts(source)).toEqual([]);
  });

  it("falls back on network errors and rejected redirects", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    expect(await fetchRepoExposedPorts(source)).toEqual([]);
  });

  it("caps the decoded body even when no Content-Length is provided", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(`FROM alpine\nEXPOSE 8080\n#${"x".repeat(128 * 1024)}`));
    expect(await fetchRepoExposedPorts(source)).toEqual([]);
  });

  it("rejects an oversized Content-Length without reading the body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.mocked(fetch).mockResolvedValue(new Response(body, { headers: { "Content-Length": "131073" } }));
    expect(await fetchRepoExposedPorts(source)).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds even a hanging fetch that ignores the abort signal", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    const result = fetchRepoExposedPorts(source);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toEqual([]);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("uses the same total deadline while reading a stalled response body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const result = fetchRepoExposedPorts(source);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("closes a body that arrives after the deadline", async () => {
    vi.useFakeTimers();
    let resolveFetch!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const result = fetchRepoExposedPorts(source);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toEqual([]);
    const cancel = vi.fn();
    resolveFetch(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
