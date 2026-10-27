import { describe, expect, it } from "vitest";
import {
  ACTIVITY_STATUSES,
  filterActivity,
  formatActivityDuration,
  formatActivityTime,
  normalizeActivity,
  sortActivity,
  type ActivityEntry,
} from "./activity";

const start = "2026-10-25T12:00:00.000Z";
const now = Date.parse(start);

function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    deploymentId: "deploy-1",
    serviceId: "app-1",
    serviceKind: "application",
    serviceName: "API",
    projectId: "project-1",
    projectName: "Demo",
    environmentName: "production",
    status: "done",
    title: "Fix sign in",
    startedAt: start,
    finishedAt: "2026-10-25T12:01:30.000Z",
    ...overrides,
  };
}

const service = {
  id: "app-1",
  kind: "application" as const,
  name: "API",
  projectId: "project-1",
  projectName: "Demo",
  environmentName: "production",
};

describe("normalizeActivity", () => {
  it("collects application and Compose deployments with display fields only", () => {
    const services = [
      { ...service, env: "PRIVATE=value", deployments: [{ deploymentId: "app-deploy", status: "done", title: " Fix sign in ", startedAt: start }] },
      { ...service, id: "compose-1", kind: "compose" as const, name: "Worker", environmentName: "staging", deployments: [{ deploymentId: "compose-deploy", status: "running", createdAt: "2026-10-25T12:02:00Z" }] },
      { ...service, id: "db-1", kind: "database" as const },
      { ...service, id: "empty-1" },
    ] as const;
    const result = normalizeActivity(services);
    expect(result.map((item) => item.deploymentId)).toEqual(["compose-deploy", "app-deploy"]);
    expect(result[0]).toEqual(entry({
      deploymentId: "compose-deploy", serviceId: "compose-1", serviceKind: "compose", serviceName: "Worker",
      environmentName: "staging", status: "running", title: "Deployment",
      startedAt: "2026-10-25T12:02:00.000Z", finishedAt: null,
    }));
    expect(result[1].title).toBe("Fix sign in");
    expect(result[1]).not.toHaveProperty("env");
    expect(services[0].deployments?.[0].title).toBe(" Fix sign in ");
  });

  it.each(ACTIVITY_STATUSES)("preserves the %s deployment status", (status) => {
    expect(normalizeActivity([{ ...service, deployments: [{ deploymentId: "d", status }] }])[0].status).toBe(status);
  });

  it.each(["idle", undefined, null, "unknown"])("treats a missing or idle status (%s) as queued", (status) => {
    expect(normalizeActivity([{ ...service, deployments: [{ deploymentId: "d", status }] }])[0].status).toBe("queued");
  });

  it("uses the title, then description, then a generic label", () => {
    const result = normalizeActivity([{ ...service, deployments: [
      { deploymentId: "title", title: "Release", description: "Commit message" },
      { deploymentId: "description", title: "  ", description: " Commit message \n" },
      { deploymentId: "fallback", title: null, description: null },
    ] }]);
    expect(result.map((item) => item.title)).toEqual(["Release", "Commit message", "Deployment"]);
  });

  it("normalizes offset dates, prefers start time, and falls back to creation time", () => {
    const result = normalizeActivity([{ ...service, deployments: [
      { deploymentId: "started", startedAt: "2026-10-25T08:00:00-04:00", createdAt: "2026-10-25T11:00:00Z", finishedAt: "2026-10-25T08:01:30-04:00" },
      { deploymentId: "created", startedAt: "invalid", createdAt: "2026-10-24T12:00:00Z", finishedAt: "invalid" },
      { deploymentId: "undated", createdAt: "invalid" },
    ] }]);
    expect(result[0]).toMatchObject({ startedAt: start, finishedAt: "2026-10-25T12:01:30.000Z" });
    expect(result[1]).toMatchObject({ startedAt: "2026-10-24T12:00:00.000Z", finishedAt: null });
    expect(result[2]).toMatchObject({ startedAt: null, finishedAt: null });
  });
});

describe("sortActivity", () => {
  it("sorts by instant, keeps ties stable and undated rows last, without mutating input", () => {
    const entries = [
      entry({ deploymentId: "missing", startedAt: null }),
      entry({ deploymentId: "older", startedAt: "2026-10-25T13:00:00+02:00" }),
      entry({ deploymentId: "newer", startedAt: "2026-10-25T08:00:00-04:00" }),
      entry({ deploymentId: "tie", startedAt: start }),
      entry({ deploymentId: "invalid", startedAt: "invalid" }),
    ];
    const before = [...entries];
    expect(sortActivity(entries).map((item) => item.deploymentId)).toEqual(["newer", "tie", "older", "missing", "invalid"]);
    expect(entries).toEqual(before);
  });
});

describe("filterActivity", () => {
  const entries = [entry(), entry({ projectId: "project-2", status: "error" }), entry({ status: "running" })];

  it("supports all projects and statuses", () => {
    expect(filterActivity(entries, {})).toEqual(entries);
    expect(filterActivity(entries, { projectId: "", status: "all" })).toEqual(entries);
    expect(filterActivity(entries, {})).not.toBe(entries);
  });

  it("combines project and status filters without changing order", () => {
    expect(filterActivity(entries, { projectId: "project-1" })).toEqual([entries[0], entries[2]]);
    expect(filterActivity(entries, { status: "error" })).toEqual([entries[1]]);
    expect(filterActivity(entries, { projectId: "project-1", status: "running" })).toEqual([entries[2]]);
    expect(filterActivity(entries, { projectId: "project-2", status: "done" })).toEqual([]);
  });
});

describe("formatActivityDuration", () => {
  it.each([
    [0, "0s"], [59_000, "59s"], [60_000, "1m 0s"], [90_000, "1m 30s"],
    [3_660_000, "1h 1m"], [93_600_000, "1d 2h"],
  ])("formats a running duration of %i milliseconds", (elapsed, expected) => {
    expect(formatActivityDuration(entry({ status: "running", finishedAt: null }), now + elapsed)).toBe(expected);
  });

  it.each(["done", "error", "cancelled"] as const)("stops counting a %s deployment at its finish", (status) => {
    expect(formatActivityDuration(entry({ status }), now + 86400_000)).toBe("1m 30s");
    expect(formatActivityDuration(entry({ status, finishedAt: null }), now + 86400_000)).toBe("—");
  });

  it("does not invent durations for queued, invalid, or reversed dates", () => {
    expect(formatActivityDuration(entry({ status: "queued" }), now)).toBe("—");
    expect(formatActivityDuration(entry({ startedAt: null }), now)).toBe("—");
    expect(formatActivityDuration(entry({ startedAt: "invalid" }), now)).toBe("—");
    expect(formatActivityDuration(entry({ finishedAt: "invalid" }), now)).toBe("—");
    expect(formatActivityDuration(entry({ finishedAt: "2026-10-24T12:00:00Z" }), now)).toBe("—");
    expect(formatActivityDuration(entry({ status: "running" }), Number.NaN)).toBe("—");
  });
});

describe("formatActivityTime", () => {
  it.each([
    [0, "just now"], [4000, "just now"], [30_000, "30s ago"], [120_000, "2m ago"],
    [7200_000, "2h ago"], [172800_000, "2d ago"], [-120_000, "in 2m"],
  ])("formats a relative offset of %i milliseconds", (elapsed, expected) => {
    expect(formatActivityTime(start, now + elapsed)).toBe(expected);
  });

  it("handles absent and invalid times", () => {
    expect(formatActivityTime(null, now)).toBe("Unknown time");
    expect(formatActivityTime("invalid", now)).toBe("Unknown time");
    expect(formatActivityTime(start, Number.NaN)).toBe("Unknown time");
  });
});
