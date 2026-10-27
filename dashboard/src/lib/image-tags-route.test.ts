import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookies, openSession, getImageTags } = vi.hoisted(() => ({
  cookies: vi.fn(),
  openSession: vi.fn(),
  getImageTags: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/session", () => ({ SESSION_COOKIE: "switchyard_session", SESSION_MAX_AGE: 604800, openSession }));
vi.mock("@/lib/image-tags", () => ({ getImageTags }));

import { GET } from "../app/api/images/tags/route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  cookies.mockResolvedValue({ get: () => ({ value: "sealed-session" }) });
  openSession.mockReturnValue({ iat: Date.now() });
  getImageTags.mockResolvedValue({ tags: [{ name: "stable", lastPushed: null }], available: true });
});

afterEach(() => vi.useRealTimers());

describe("image tags route", () => {
  it("verifies the session before looking up the image", async () => {
    const response = await GET(new Request("http://localhost/api/images/tags?image=nginx%3Astable"));
    expect(openSession).toHaveBeenCalledWith("sealed-session");
    expect(getImageTags).toHaveBeenCalledWith("nginx:stable");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ tags: [{ name: "stable", lastPushed: null }], available: true });
  });

  it.each([null, { iat: 0 }, { iat: "invalid" }, { iat: Number.NaN }, { iat: Date.parse("2027-01-01") }])(
    "rejects forged, expired, invalid, or future sessions",
    async (session) => {
      openSession.mockReturnValue(session);
      const response = await GET(new Request("http://localhost/api/images/tags?image=nginx"));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ tags: [], available: false });
      expect(getImageTags).not.toHaveBeenCalled();
    },
  );

  it("passes an empty reference for a missing image", async () => {
    await GET(new Request("http://localhost/api/images/tags"));
    expect(getImageTags).toHaveBeenCalledWith("");
  });
});
