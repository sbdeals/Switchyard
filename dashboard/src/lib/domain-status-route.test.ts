vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dokployRequest, checkDomainStatus, unstableRethrow } = vi.hoisted(() => ({
  dokployRequest: vi.fn(),
  checkDomainStatus: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/navigation", () => ({ unstable_rethrow: unstableRethrow }));
vi.mock("@/lib/dokploy", () => ({ request: dokployRequest }));
vi.mock("@/lib/domain-status-network", () => ({ checkDomainStatus }));
vi.mock("@/lib/domain-status-access", async () => import("./domain-status-access"));

import { GET } from "../app/api/services/domain-status/route";

const query = "serviceType=application&serviceId=app-1&domainId=domain-1";
const request = (search = query) => new Request(`http://localhost/api/services/domain-status?${search}`);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("domain status route", () => {
  it("rejects arbitrary host input before accessing Dokploy or the checker", async () => {
    const response = await GET(request(`${query}&host=localhost`));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(dokployRequest).not.toHaveBeenCalled();
    expect(checkDomainStatus).not.toHaveBeenCalled();
  });

  it("returns 404 without checking a service outside the user's tree", async () => {
    dokployRequest.mockResolvedValue([]);
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(dokployRequest).toHaveBeenCalledExactlyOnceWith("project.all");
    expect(checkDomainStatus).not.toHaveBeenCalled();
  });

  it("authorizes the stored domain before checking and returns its result", async () => {
    dokployRequest
      .mockResolvedValueOnce([{ environments: [{ applications: [{ applicationId: "app-1" }] }] }])
      .mockResolvedValueOnce({
        applicationId: "app-1",
        domains: [{ domainId: "domain-1", host: "stored.example.test", https: false }],
      });
    const status = { level: "ok", dns: { addresses: ["203.0.113.2"] }, reachability: { statusCode: 200 } };
    checkDomainStatus.mockImplementation(async () => {
      expect(dokployRequest).toHaveBeenCalledTimes(2);
      return status;
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(status);
    expect(checkDomainStatus).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: "app-1", domainId: "domain-1", host: "stored.example.test", https: false,
    }));
  });

  it("fails closed on Dokploy errors without disclosing their details", async () => {
    const error = new Error("Private backend failure detail");
    dokployRequest.mockRejectedValue(error);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Workspace unavailable", code: "unavailable" });
    expect(unstableRethrow).toHaveBeenCalledWith(error);
    expect(checkDomainStatus).not.toHaveBeenCalled();
  });

  it("preserves Next authentication redirects", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    dokployRequest.mockRejectedValue(redirect);
    unstableRethrow.mockImplementation((error) => { throw error; });
    await expect(GET(request())).rejects.toBe(redirect);
    expect(checkDomainStatus).not.toHaveBeenCalled();
  });
});
