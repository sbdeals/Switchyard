import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  knownAppNamesForRequest: vi.fn(),
  readServiceStats: vi.fn(),
  rethrow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.rethrow }));
vi.mock("@/lib/dokploy", () => ({ knownAppNamesForRequest: mocks.knownAppNamesForRequest }));
vi.mock("@/lib/docker", () => ({ readServiceStats: mocks.readServiceStats }));

import { GET } from "@/app/api/services/metrics/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.knownAppNamesForRequest.mockResolvedValue(new Set(["alice-app"]));
  mocks.readServiceStats.mockResolvedValue({ status: "not-running", sample: null, containers: 0 });
});

describe("service metrics route", () => {
  it("requires an app before loading the workspace", async () => {
    expect((await GET(new Request("http://localhost/api/services/metrics"))).status).toBe(400);
    expect(mocks.knownAppNamesForRequest).not.toHaveBeenCalled();
    expect(mocks.readServiceStats).not.toHaveBeenCalled();
  });

  it("loads ownership without runtime Docker reads and returns non-cacheable JSON", async () => {
    const response = await GET(new Request("http://localhost/api/services/metrics?app=alice-app"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "not-running", sample: null, containers: 0 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.knownAppNamesForRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.readServiceStats).toHaveBeenCalledWith("alice-app", new Set(["alice-app"]));
  });

  it("rechecks the current user's workspace even after another user sampled the service", async () => {
    await GET(new Request("http://localhost/api/services/metrics?app=alice-app"));
    mocks.knownAppNamesForRequest.mockResolvedValue(new Set(["bob-app"]));
    const response = await GET(new Request("http://localhost/api/services/metrics?app=alice-app"));
    expect(response.status).toBe(403);
    expect(mocks.knownAppNamesForRequest).toHaveBeenCalledTimes(2);
    expect(mocks.readServiceStats).toHaveBeenCalledTimes(1);
    expect((await GET(new Request("http://localhost/api/services/metrics?app=bob-app"))).status).toBe(200);
    expect(mocks.readServiceStats).toHaveBeenLastCalledWith("bob-app", new Set(["bob-app"]));
  });

  it("fails closed when the user's workspace cannot be loaded", async () => {
    mocks.knownAppNamesForRequest.mockRejectedValue(new Error("session expired"));
    expect((await GET(new Request("http://localhost/api/services/metrics?app=alice-app"))).status).toBe(503);
    expect(mocks.readServiceStats).not.toHaveBeenCalled();
  });

  it("preserves Next authentication redirects", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.knownAppNamesForRequest.mockRejectedValue(redirect);
    mocks.rethrow.mockImplementation(() => { throw redirect; });
    await expect(GET(new Request("http://localhost/api/services/metrics?app=alice-app"))).rejects.toBe(redirect);
    expect(mocks.readServiceStats).not.toHaveBeenCalled();
  });
});
