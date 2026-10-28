import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetch, getImageTags } = vi.hoisted(() => ({
  fetch: vi.fn(),
  getImageTags: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/docker", () => ({}));
vi.mock("@/lib/image-tags", () => ({ getImageTags }));

import { GET } from "../app/api/images/tags/route";
import { sealSession } from "./session";

function request(image = "nginx", session: { iat: unknown } | null = { iat: Date.now() }) {
  const token = session ? sealSession({ dokployCookie: "dokploy=test-user", email: "test@example.test", iat: session.iat as number }) : "x";
  return new Request(`http://localhost/api/images/tags${image ? `?image=${encodeURIComponent(image)}` : ""}`,
    { headers: { cookie: `switchyard_session=${token}` } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "image-tags-test-secret");
  vi.stubGlobal("fetch", fetch);
  fetch.mockImplementation(async () => Response.json([]));
  getImageTags.mockResolvedValue({ tags: [{ name: "stable", lastPushed: null }], available: true });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("image tags route", () => {
  it("verifies the session before looking up the image", async () => {
    const response = await GET(request("nginx:stable"));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/project.all"),
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: "dokploy=test-user" }) }));
    expect(getImageTags).toHaveBeenCalledWith("nginx:stable");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ tags: [{ name: "stable", lastPushed: null }], available: true });
  });

  it.each([null, { iat: 0 }, { iat: "invalid" }, { iat: Number.NaN }, { iat: Date.parse("2027-01-01") }])(
    "rejects forged, expired, invalid, or future sessions",
    async (session) => {
      const response = await GET(request("nginx", session));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "unauthenticated" });
      expect(fetch).not.toHaveBeenCalled();
      expect(getImageTags).not.toHaveBeenCalled();
    },
  );

  it("passes an empty reference for a missing image", async () => {
    await GET(request(""));
    expect(getImageTags).toHaveBeenCalledWith("");
  });
});
