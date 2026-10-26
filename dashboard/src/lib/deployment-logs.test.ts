import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({ request: vi.fn() }));

import { request } from "./dokploy";
import { readFailedDeploymentLog } from "./deployment-logs";

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
