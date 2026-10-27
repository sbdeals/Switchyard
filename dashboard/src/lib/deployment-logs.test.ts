import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({ request: vi.fn() }));

import { request } from "./dokploy";
import type { AppDeployment } from "./dokploy";
import { deploymentForService, readFailedDeploymentLog } from "./deployment-logs";

const requestMock = vi.mocked(request);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("readFailedDeploymentLog", () => {
  it("reads the selected failed deployment through Dokploy's authorized build-log endpoint", async () => {
    requestMock.mockResolvedValueOnce([
      { deploymentId: "newer", status: "done" },
      { deploymentId: "failed&id", status: "error" },
    ]);
    requestMock.mockResolvedValueOnce("app Pulling\nmanifest unknown\n");

    await expect(readFailedDeploymentLog("failed&id")).resolves.toBe("app Pulling\nmanifest unknown\n");
    expect(requestMock.mock.calls).toEqual([
      ["deployment.allCentralized"],
      ["deployment.readLogs?deploymentId=failed%26id&tail=10000"],
    ]);
  });

  it("rejects an empty deployment ID before reading any logs", async () => {
    await expect(readFailedDeploymentLog("  ")).rejects.toMatchObject({ status: 400 });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("cannot read a deployment outside the current user's accessible list", async () => {
    requestMock.mockResolvedValueOnce([{ deploymentId: "mine", status: "error" }]);

    await expect(readFailedDeploymentLog("someone-elses")).rejects.toMatchObject({ status: 404 });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each(["running", "done", "cancelled"])("rejects a selected %s deployment even if another deployment failed", async (status) => {
    requestMock.mockResolvedValueOnce([
      { deploymentId: "failed", status: "error" },
      { deploymentId: "selected", status },
    ]);

    await expect(readFailedDeploymentLog("selected")).rejects.toMatchObject({ status: 409 });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each(["", "\n  \n", null])("reports missing logs as unavailable instead of a no-match diagnosis (%j)", async (log) => {
    requestMock.mockResolvedValueOnce([{ deploymentId: "failed", status: "error" }]);
    requestMock.mockResolvedValueOnce(log);

    await expect(readFailedDeploymentLog("failed")).rejects.toMatchObject({ status: 503 });
  });

  it("fails closed when the accessible deployment list cannot be read", async () => {
    requestMock.mockRejectedValueOnce(new Error("Dokploy unavailable"));

    await expect(readFailedDeploymentLog("failed")).rejects.toThrow("Dokploy unavailable");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("does not substitute runtime logs when the deployment log request fails", async () => {
    requestMock.mockResolvedValueOnce([{ deploymentId: "failed", status: "error" }]);
    requestMock.mockRejectedValueOnce(new Error("Log read denied"));

    await expect(readFailedDeploymentLog("failed")).rejects.toThrow("Log read denied");
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});

const older: AppDeployment = {
  deploymentId: "older",
  title: "Earlier deploy",
  description: null,
  status: "error",
  createdAt: "2026-10-26T10:00:00Z",
  startedAt: "2026-10-26T10:00:01Z",
  finishedAt: "2026-10-26T10:00:10Z",
  rollbackId: null,
};
const newer = { ...older, deploymentId: "newer", status: "done" };
const services = [
  { id: "app", kind: "application" as const, deployments: [newer, older] },
  { id: "stack", kind: "compose" as const, deployments: [{ ...older, deploymentId: "compose-deploy" }] },
  { id: "db", kind: "database" as const },
];

describe("deploymentForService", () => {
  it("selects the requested deployment, even when it is not the latest", () => {
    expect(deploymentForService(services, "app", "older")).toBe(older);
    expect(deploymentForService(services, "app", "newer")).toBe(newer);
  });

  it("supports compose deployments", () => {
    expect(deploymentForService(services, "stack", "compose-deploy")?.deploymentId).toBe("compose-deploy");
  });

  it("rejects a deployment belonging to another service", () => {
    expect(deploymentForService(services, "stack", "older")).toBeNull();
    expect(deploymentForService(services, "app", "compose-deploy")).toBeNull();
  });

  it("fails closed for missing services, deployments, and databases", () => {
    expect(deploymentForService([], "app", "older")).toBeNull();
    expect(deploymentForService(services, "hidden-app", "older")).toBeNull();
    expect(deploymentForService(services, "app", "missing")).toBeNull();
    expect(deploymentForService(services, "db", "older")).toBeNull();
    expect(deploymentForService([{ id: "db", kind: "database", deployments: [older] }], "db", "older")).toBeNull();
  });
});
