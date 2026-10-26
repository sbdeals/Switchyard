import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadWorkspace, readDeploymentLogs } = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  readDeploymentLogs: vi.fn(),
}));

vi.mock("@/lib/dokploy", () => ({ loadWorkspace, readDeploymentLogs }));
vi.mock("@/lib/deployment-logs", () => import("./deployment-logs"));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));

import { GET } from "../app/api/services/deployment-logs/route";

const visibleServices = [{
  id: "app",
  kind: "application",
  deployments: [{ deploymentId: "newer" }, { deploymentId: "requested" }],
}];
const request = (query = "serviceId=app&deploymentId=requested") =>
  new Request(`http://localhost/api/services/deployment-logs?${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  loadWorkspace.mockResolvedValue({ services: visibleServices });
  readDeploymentLogs.mockResolvedValue("Build finished");
});

describe("deployment logs endpoint", () => {
  it("reads the exact deployment after checking the current user's workspace", async () => {
    readDeploymentLogs.mockResolvedValue("\u001b[32mBuild finished\u001b[0m");
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ logs: "Build finished" });
    expect(readDeploymentLogs).toHaveBeenCalledWith("requested");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("requires both service and deployment identifiers", async () => {
    expect((await GET(request("serviceId=app"))).status).toBe(400);
    expect((await GET(request("deploymentId=requested"))).status).toBe(400);
    expect(loadWorkspace).not.toHaveBeenCalled();
    expect(readDeploymentLogs).not.toHaveBeenCalled();
  });

  it("rejects invisible services and deployments from another service", async () => {
    expect((await GET(request("serviceId=hidden&deploymentId=requested"))).status).toBe(403);
    expect((await GET(request("serviceId=app&deploymentId=foreign"))).status).toBe(403);
    expect(readDeploymentLogs).not.toHaveBeenCalled();
  });

  it("rechecks visibility for each user request without a shared allowlist", async () => {
    expect((await GET(request())).status).toBe(200);
    loadWorkspace.mockResolvedValue({ services: [] });
    expect((await GET(request())).status).toBe(403);
    expect(loadWorkspace).toHaveBeenCalledTimes(2);
    expect(readDeploymentLogs).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the workspace cannot be authorized", async () => {
    loadWorkspace.mockRejectedValue(new Error("backend unavailable"));
    expect((await GET(request())).status).toBe(503);
    expect(readDeploymentLogs).not.toHaveBeenCalled();
  });

  it("returns a safe error if Dokploy refuses the log read", async () => {
    readDeploymentLogs.mockRejectedValue(new Error("internal response details"));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Deployment logs unavailable." });
  });

  it("preserves login redirects from per-user authentication", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    loadWorkspace.mockRejectedValue(redirect);
    await expect(GET(request())).rejects.toBe(redirect);
    expect(readDeploymentLogs).not.toHaveBeenCalled();
  });
});
