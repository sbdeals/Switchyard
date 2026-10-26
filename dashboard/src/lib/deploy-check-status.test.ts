import { describe, expect, it } from "vitest";
import { applicationCheckSupport, observeDeployChecks, type CheckContainer } from "./deploy-check-status";

const checks = { healthcheckPath: "/ready", healthcheckTimeout: 30, healthcheckPort: 80, preDeployCommand: "exit 0", serviceName: "web" };
const deployedAt = "2026-10-26T01:00:00.000Z";
const test = ["CMD-SHELL", "check"];
const web: CheckContainer = { serviceName: "web", createdAt: "2026-10-26T01:00:01.000Z", state: "running", health: "healthy", healthTest: test, healthRan: true };
const job: CheckContainer = { ...web, serviceName: "sy-predeploy", state: "exited", exitCode: 0, command: ["exit 0"], entrypoint: ["/bin/sh", "-c"] };

describe("deploy check observations", () => {
  it("reports success only after the configured probe and command actually ran", () => {
    expect(observeDeployChecks(checks, [web, job], deployedAt, test)).toEqual({ healthcheck: "Passed (HTTP 2xx)", preDeploy: "Passed (exit 0)" });
  });
  it("does not infer success from an old container or absent deployment", () => {
    expect(observeDeployChecks(checks, [web, job], "2026-10-26T02:00:00.000Z", test).healthcheck).toContain("Not observed");
    expect(observeDeployChecks(checks, [web, job], undefined, test).preDeploy).toContain("Not observed");
  });
  it("does not call an unrun, changed, stopped, or partly healthy check passed", () => {
    for (const containers of [[{ ...web, healthRan: false }], [{ ...web, healthTest: ["CMD", "true"] }], [{ ...web, state: "exited" }], [web, { ...web, health: "starting" }]]) {
      expect(observeDeployChecks(checks, containers, deployedAt, test).healthcheck).not.toContain("Passed");
    }
    expect(observeDeployChecks(checks, [{ ...job, command: ["something else"] }], deployedAt, test).preDeploy).toContain("Not observed");
  });
  it("reports unhealthy and aborts independently", () => {
    expect(observeDeployChecks(checks, [{ ...web, health: "unhealthy" }, { ...job, exitCode: 1 }], deployedAt, test)).toEqual({ healthcheck: "Unhealthy", preDeploy: "Failed — deploy aborted" });
  });
  it("reports disabled checks", () => {
    expect(observeDeployChecks({ ...checks, healthcheckPath: "", preDeployCommand: "" }, [], deployedAt, test)).toEqual({ healthcheck: "Not configured", preDeploy: "Not configured" });
  });
  it("requires a verified local Swarm manager for application checks", () => {
    expect(applicationCheckSupport(false, false).healthcheck).toBe(false);
    expect(applicationCheckSupport(true, true).healthcheck).toBe(false);
    expect(applicationCheckSupport(true, false)).toMatchObject({ healthcheck: true, preDeploy: false });
  });
});
