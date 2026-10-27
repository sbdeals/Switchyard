import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/workspace/route";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getCookie: vi.fn(),
  openSession: vi.fn(),
  redirect: new Error("NEXT_REDIRECT"),
}));

vi.mock("server-only", () => ({}));
vi.mock("./docker", () => ({}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-session",
  openSession: mocks.openSession,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.getCookie }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => { throw mocks.redirect; },
  unstable_rethrow: (error: unknown) => {
    if (error === mocks.redirect) throw error;
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => vi.unstubAllGlobals());

describe("workspace polling authentication through loadWorkspace", () => {
  it.each([undefined, "invalid-session"])("rejects a missing or invalid sealed session (%s) before contacting the backend", async (token) => {
    mocks.getCookie.mockReturnValue(token ? { value: token } : undefined);
    mocks.openSession.mockReturnValue(null);

    await expect(GET()).rejects.toBe(mocks.redirect);
    expect(mocks.openSession).toHaveBeenCalledWith(token);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("uses the current user's session on every poll", async () => {
    mocks.getCookie.mockReturnValue({ value: "sealed-test-session" });
    mocks.openSession.mockReturnValue({ dokployCookie: "first-user-session" });
    mocks.fetch.mockImplementation(async () => Response.json([]));

    expect(await (await GET()).json()).toEqual({ services: [], projects: [], edges: [], graph: { edges: [], warnings: {} } });
    mocks.openSession.mockReturnValue({ dokployCookie: "second-user-session" });
    expect(await (await GET()).json()).toEqual({ services: [], projects: [], edges: [], graph: { edges: [], warnings: {} } });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][1].headers.Cookie).toBe("first-user-session");
    expect(mocks.fetch.mock.calls[1][1].headers.Cookie).toBe("second-user-session");
  });

  it("propagates an expired upstream session without falling back to admin credentials", async () => {
    mocks.getCookie.mockReturnValue({ value: "sealed-test-session" });
    mocks.openSession.mockReturnValue({ dokployCookie: "expired-user-session" });
    mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(GET()).rejects.toBe(mocks.redirect);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].headers.Cookie).toBe("expired-user-session");
  });
});
