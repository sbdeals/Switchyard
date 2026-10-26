import { describe, expect, it } from "vitest";
import type { AppDeployment } from "./dokploy";
import { deploymentForService } from "./deployment-logs";

const older: AppDeployment = {
  deploymentId: "older",
  title: "Earlier deploy",
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
