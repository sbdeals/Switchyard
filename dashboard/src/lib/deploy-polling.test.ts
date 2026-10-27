import { describe, expect, it } from "vitest";
import { pollingInterval } from "./deploy-polling";

const idle = {
  projectId: "project-1",
  deployments: [{ status: "done" }, { status: "error" }, { status: "cancelled" }],
};
const running = { projectId: "project-2", deployments: [{ status: "running" }] };
const defaults = { hidden: false, services: [idle], projectId: null, failures: 0 };

describe("pollingInterval", () => {
  it("pauses hidden tabs even with active deployments or failed refreshes", () => {
    expect(pollingInterval({ ...defaults, hidden: true })).toBeNull();
    expect(pollingInterval({ ...defaults, hidden: true, services: [running], failures: 3 })).toBeNull();
  });

  it("uses ten seconds without an active deployment", () => {
    expect(pollingInterval(defaults)).toBe(10_000);
    expect(pollingInterval({ ...defaults, services: [] })).toBe(10_000);
    expect(pollingInterval({ ...defaults, services: [{ projectId: "project-1" }] })).toBe(10_000);
  });

  it.each(["running", "queued"])("uses five seconds when any visible service has a %s deployment", (status) => {
    expect(pollingInterval({ ...defaults, services: [idle, {
      projectId: "project-2", deployments: [{ status: "done" }, { status }],
    }] })).toBe(5_000);
  });

  it("only accelerates for services in the selected project, or all projects by default", () => {
    const services = [idle, running];
    expect(pollingInterval({ ...defaults, services })).toBe(5_000);
    expect(pollingInterval({ ...defaults, services, projectId: "project-1" })).toBe(10_000);
    expect(pollingInterval({ ...defaults, services, projectId: "project-2" })).toBe(5_000);
    expect(pollingInterval({ ...defaults, services, projectId: "missing" })).toBe(10_000);
  });

  it.each(["done", "error", "cancelled", "canceled", "idle", "unknown"])("does not accelerate for %s", (status) => {
    expect(pollingInterval({ ...defaults, services: [{
      projectId: "project-1", deployments: [{ status }],
    }] })).toBe(10_000);
  });

  it.each([
    [0, 10_000, 5_000],
    [1, 20_000, 10_000],
    [2, 40_000, 20_000],
    [3, 60_000, 40_000],
    [4, 60_000, 60_000],
    [100, 60_000, 60_000],
  ])("backs off after %s failures, including active deployments", (failures, normal, active) => {
    expect(pollingInterval({ ...defaults, failures })).toBe(normal);
    expect(pollingInterval({ ...defaults, services: [running], failures })).toBe(active);
  });

  it("returns to the base interval when a successful refresh resets failures", () => {
    expect(pollingInterval({ ...defaults, failures: 3 })).toBe(60_000);
    expect(pollingInterval({ ...defaults, failures: 0 })).toBe(10_000);
  });

  it.each([
    [-1, 10_000],
    [-Infinity, 10_000],
    [NaN, 10_000],
    [0.9, 10_000],
    [1.9, 20_000],
    [Infinity, 60_000],
  ])("bounds invalid or fractional failure counts: %s", (failures, expected) => {
    expect(pollingInterval({ ...defaults, failures })).toBe(expected);
  });
});
