import { describe, expect, it } from "vitest";
import type { AppDeployment } from "./dokploy";
import {
  durationBarHeight,
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime,
  getDeploymentDuration,
  getDeployStats,
  isDeploymentRunning,
  median,
  p90,
  sortDeployments,
  successRate,
} from "./deploy-stats";

const start = "2026-10-26T12:00:00.000Z";
const now = Date.parse(start) + 72_000;
const deployment = (patch: Partial<AppDeployment> = {}): AppDeployment => ({
  deploymentId: "deploy-1",
  title: "Deploy",
  status: "done",
  createdAt: start,
  startedAt: start,
  finishedAt: new Date(now).toISOString(),
  rollbackId: null,
  ...patch,
});

describe("deployment duration", () => {
  it("uses start and finish timestamps, independently of creation and current time", () => {
    const row = deployment({ createdAt: "2026-10-25T12:00:00Z" });
    expect(getDeploymentDuration(row, now + 5000)).toBe(72_000);
    expect(getDeploymentDuration(row, now + 60_000)).toBe(72_000);
    expect(isDeploymentRunning(row)).toBe(false);
  });

  it("ticks only running deployments without a finish", () => {
    const row = deployment({ status: "running", finishedAt: null });
    expect(isDeploymentRunning(row)).toBe(true);
    expect(getDeploymentDuration(row, now)).toBe(72_000);
    expect(getDeploymentDuration(row, now + 1000)).toBe(73_000);
    expect(isDeploymentRunning({ ...row, finishedAt: start })).toBe(false);
    expect(getDeploymentDuration({ ...row, finishedAt: start }, now)).toBeNull();
  });

  it.each(["done", "error", "cancelled"])("never ticks a %s deployment with a missing finish", (status) => {
    const row = deployment({ status, finishedAt: null });
    expect(isDeploymentRunning(row)).toBe(false);
    expect(getDeploymentDuration(row, now)).toBeNull();
  });

  it.each(["queued", "idle", "unknown"])("does not invent a duration for %s", (status) => {
    expect(getDeploymentDuration(deployment({ status }), now)).toBeNull();
  });

  it("accepts recorded failure, cancellation, and zero durations", () => {
    expect(getDeploymentDuration(deployment({ status: "error" }), now)).toBe(72_000);
    expect(getDeploymentDuration(deployment({ status: "cancelled" }), now)).toBe(72_000);
    expect(getDeploymentDuration(deployment({ finishedAt: start }), now)).toBe(0);
  });

  it.each([
    { startedAt: null }, { finishedAt: null }, { startedAt: "invalid" },
    { finishedAt: "invalid" }, { finishedAt: "" },
    { startedAt: "2026-10-27T12:00:00Z" },
  ])("rejects missing, invalid, or reversed timestamps: %o", (patch) => {
    expect(getDeploymentDuration(deployment(patch), now)).toBeNull();
  });

  it("rejects omitted fields and future starts instead of using creation time", () => {
    expect(getDeploymentDuration({ status: "done" }, now)).toBeNull();
    expect(getDeploymentDuration({ status: "running", startedAt: start }, now - 100_000)).toBeNull();
    expect(getDeploymentDuration({ status: "running", startedAt: start }, NaN)).toBeNull();
  });
});

describe("duration presentation", () => {
  it.each([
    [null, "—"], [-1, "—"], [NaN, "—"], [Infinity, "—"],
    [0, "0s"], [999, "0s"], [34_000, "34s"], [60_000, "1m 0s"],
    [72_999, "1m 12s"], [3_672_000, "1h 1m 12s"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatDuration(value)).toBe(expected);
  });

  it("scales bars from durations and gives unavailable values no fabricated height", () => {
    expect(durationBarHeight(20_000, 40_000)).toBe(16);
    expect(durationBarHeight(40_000, 40_000)).toBe(32);
    for (const value of [null, NaN, -1, 0]) expect(durationBarHeight(value, 40_000)).toBe(0);
    expect(durationBarHeight(0, 0)).toBe(0);
  });
});

describe("deployment summary", () => {
  it("calculates odd/even medians and nearest-rank p90 without mutating inputs", () => {
    const values = [30, 10, 20, 40];
    expect(median(values)).toBe(25);
    expect(median([30, 10, 20])).toBe(20);
    expect(p90(values)).toBe(40);
    expect(p90(Array.from({ length: 10 }, (_, index) => index + 1))).toBe(9);
    expect(values).toEqual([30, 10, 20, 40]);
  });

  it("handles empty, single, zero and invalid duration samples", () => {
    expect(median([])).toBeNull();
    expect(p90([])).toBeNull();
    expect(median([0])).toBe(0);
    expect(p90([12])).toBe(12);
    expect(median([NaN, -1, Infinity])).toBeNull();
    expect(p90([NaN, -1, 10])).toBe(10);
  });

  it("excludes cancelled, queued, running and unknown attempts from success rate", () => {
    const statuses = ["done", "done", "error", "cancelled", "canceled", "queued", "running", "idle"];
    expect(successRate(statuses.map((status) => ({ status })))).toBeCloseTo(200 / 3);
    expect(successRate([{ status: "error" }])).toBe(0);
    expect(successRate([{ status: "done" }])).toBe(100);
    expect(successRate([{ status: "queued" }, { status: "cancelled" }])).toBeNull();
    expect(successRate([])).toBeNull();
  });

  it("sorts timestamps chronologically, including offsets, with invalid dates last", () => {
    const rows = [
      deployment({ deploymentId: "unknown", createdAt: "invalid" }),
      deployment({ deploymentId: "older", createdAt: "2026-10-26T13:00:00+02:00" }),
      deployment({ deploymentId: "newer", createdAt: start }),
    ];
    expect(sortDeployments(rows).map((row) => row.deploymentId)).toEqual(["newer", "older", "unknown"]);
    expect(rows[0].deploymentId).toBe("unknown");
  });

  it("limits every summary metric to the newest 20 deploys", () => {
    const rows = Array.from({ length: 22 }, (_, index) => deployment({
      deploymentId: `deploy-${index}`,
      createdAt: new Date(now + index * 1000).toISOString(),
      status: index < 2 ? "error" : "done",
      finishedAt: new Date(Date.parse(start) + (index < 2 ? 1000_000 : 20_000)).toISOString(),
    }));
    const stats = getDeployStats(rows);
    expect(stats.recent).toHaveLength(20);
    expect(stats.successRate).toBe(100);
    expect(stats.medianDurationMs).toBe(20_000);
    expect(stats.p90DurationMs).toBe(20_000);
    expect(stats.lastSuccessful?.deploymentId).toBe("deploy-21");
    expect(stats.durationCount).toBe(20);
  });

  it("uses only measured completed durations, while counting outcomes without timing", () => {
    const stats = getDeployStats([
      deployment(),
      deployment({ status: "error", finishedAt: new Date(now + 20_000).toISOString() }),
      deployment({ status: "done", startedAt: null }),
      deployment({ status: "cancelled" }),
      deployment({ status: "running", finishedAt: null }),
      deployment({ status: "queued" }),
    ]);
    expect(stats.successRate).toBeCloseTo(200 / 3);
    expect(stats.medianDurationMs).toBe(82_000);
    expect(stats.p90DurationMs).toBe(92_000);
    expect(stats.durationCount).toBe(2);
  });

  it("returns unavailable metrics for empty history and never finds an old success outside the window", () => {
    expect(getDeployStats([])).toEqual({
      recent: [], successRate: null, medianDurationMs: null, p90DurationMs: null,
      lastSuccessful: null, durationCount: 0,
    });
    const rows = Array.from({ length: 21 }, (_, index) => deployment({
      createdAt: new Date(now + index * 1000).toISOString(),
      status: index === 0 ? "done" : "error", startedAt: null,
    }));
    expect(getDeployStats(rows).lastSuccessful).toBeNull();
    expect(getDeployStats(rows).medianDurationMs).toBeNull();
  });
});

describe("deployment time", () => {
  it.each([
    [0, "just now"], [34_000, "34s ago"], [72_000, "1m ago"],
    [3_600_000, "1h ago"], [86_400_000, "1d ago"], [-60_000, "in 1m"],
  ])("formats relative times (%s)", (elapsed, expected) => {
    expect(formatRelativeTime(start, Date.parse(start) + elapsed)).toBe(expected);
  });

  it("supplies absolute tooltips and handles unavailable timestamps", () => {
    expect(formatAbsoluteTime(start)).toBe("2026-10-26 12:00:00.000 UTC");
    expect(formatAbsoluteTime("2026-10-26T14:00:00+02:00")).toBe("2026-10-26 12:00:00.000 UTC");
    for (const value of [null, undefined, "", "invalid"]) {
      expect(formatRelativeTime(value, now)).toBe("—");
      expect(formatAbsoluteTime(value)).toBe("Time unavailable");
    }
  });
});
