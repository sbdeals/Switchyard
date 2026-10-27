import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unstable_rethrow } from "next/navigation";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  openSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-session" }) }),
}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard_session",
  openSession: mocks.openSession,
}));
vi.mock("./docker", () => ({
  deriveComposeRuntime: vi.fn(),
  deriveSwarmRuntime: vi.fn(),
  listRuntimeStates: vi.fn(),
}));

import { request } from "./dokploy";
import { classifyWorkspaceError } from "./workspace-error";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.openSession.mockReturnValue({ dokployCookie: "test-cookie" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Dokploy request failures", () => {
  it.each(["TimeoutError", "AbortError"])("preserves %s as a classifiable cause", async (name) => {
    const cause = new DOMException("Request deadline reached", name);
    mocks.fetch.mockRejectedValueOnce(cause);
    const error = await request("project.all").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("cause", cause);
    expect(error).toHaveProperty("message", expect.stringContaining("timed out"));
    expect(classifyWorkspaceError(error)).toBe("unreachable");
  });

  it("propagates connection failures without losing their cause", async () => {
    const error = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    mocks.fetch.mockRejectedValueOnce(error);
    await expect(request("project.all")).rejects.toBe(error);
  });

  it("preserves transport errors when reading the response body", async () => {
    const error = new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } });
    const response = new Response("{}");
    vi.spyOn(response, "text").mockRejectedValueOnce(error);
    mocks.fetch.mockResolvedValueOnce(response);
    await expect(request("project.all")).rejects.toBe(error);
    expect(classifyWorkspaceError(error)).toBe("unreachable");
  });

  it.each([403, 500])("retains HTTP %i status for classification", async (status) => {
    mocks.fetch.mockResolvedValueOnce(new Response("API error", { status }));
    const error = await request("project.all").catch((error: unknown) => error);
    expect(error).toHaveProperty("status", status);
    expect(classifyWorkspaceError(error)).toBe(status === 403 ? "auth" : "unknown");
  });

  it("keeps HTTP 401 as a Next login redirect", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    const error = await request("project.all").catch((error: unknown) => error);
    expect(error).toHaveProperty("digest", expect.stringContaining(";/login;"));
    expect(() => unstable_rethrow(error)).toThrow(error as Error);
  });

  it("redirects an invalid session before making a request", async () => {
    mocks.openSession.mockReturnValueOnce(null);
    const error = await request("project.all").catch((error: unknown) => error);
    expect(error).toHaveProperty("digest", expect.stringContaining(";/login;"));
    expect(() => unstable_rethrow(error)).toThrow(error as Error);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps malformed JSON distinct from a connectivity failure", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("invalid json"));
    const error = await request("project.all").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(SyntaxError);
    expect(classifyWorkspaceError(error)).toBe("unknown");
  });
});
