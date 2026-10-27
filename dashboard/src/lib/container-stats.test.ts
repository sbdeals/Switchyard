import { describe, expect, it } from "vitest";
import { sumContainerSamples, toContainerSample, type DockerStats } from "./container-stats";

const cpuStats: DockerStats = {
  cpu_stats: {
    cpu_usage: { total_usage: 300, percpu_usage: [150, 150] },
    system_cpu_usage: 2_000,
    online_cpus: 4,
  },
  precpu_stats: {
    cpu_usage: { total_usage: 100 },
    system_cpu_usage: 1_000,
  },
};

describe("toContainerSample", () => {
  it("computes CPU from usage and system deltas across online CPUs", () => {
    expect(toContainerSample(cpuStats, 123)).toMatchObject({ ts: 123, cpu: 80 });
  });

  it("reports an idle CPU as zero, and permits more than one CPU's usage", () => {
    expect(toContainerSample({
      ...cpuStats,
      cpu_stats: { ...cpuStats.cpu_stats, cpu_usage: { total_usage: 100 } },
    }).cpu).toBe(0);
    expect(toContainerSample({
      ...cpuStats,
      cpu_stats: { ...cpuStats.cpu_stats, cpu_usage: { total_usage: 600 } },
    }).cpu).toBe(200);
  });

  it.each([undefined, null, 0])("falls back to per-CPU count when online_cpus is %s", (online) => {
    expect(toContainerSample({
      ...cpuStats,
      cpu_stats: { ...cpuStats.cpu_stats, online_cpus: online },
    }).cpu).toBe(40);
  });

  it.each<DockerStats>([
    {},
    { cpu_stats: cpuStats.cpu_stats },
    { ...cpuStats, cpu_stats: { ...cpuStats.cpu_stats, system_cpu_usage: 1_000 } },
    { ...cpuStats, cpu_stats: { ...cpuStats.cpu_stats, system_cpu_usage: 900 } },
    { ...cpuStats, cpu_stats: { ...cpuStats.cpu_stats, cpu_usage: { total_usage: 50 } } },
    { ...cpuStats, cpu_stats: { ...cpuStats.cpu_stats, cpu_usage: {} } },
    { ...cpuStats, cpu_stats: { ...cpuStats.cpu_stats, online_cpus: NaN } },
    { ...cpuStats, cpu_stats: { ...cpuStats.cpu_stats, online_cpus: -1 } },
    { ...cpuStats, cpu_stats: { ...cpuStats.cpu_stats, system_cpu_usage: Infinity } },
    { ...cpuStats, cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2_000 } },
  ])("returns unknown CPU for missing or invalid counters: %j", (stats) => {
    expect(toContainerSample(stats).cpu).toBeNull();
  });

  it.each([
    { total_inactive_file: 200, inactive_file: 100, cache: 50 },
    { inactive_file: 200, cache: 50 },
    { cache: 200 },
  ])("subtracts cache using the cgroup field priority: %j", (stats) => {
    expect(toContainerSample({ memory_stats: { usage: 1_000, limit: 2_000, stats } }, 123)).toEqual({
      ts: 123,
      cpu: null,
      memUsed: 800,
      memLimit: 2_000,
      memPct: 40,
    });
  });

  it("preserves a valid zero cache instead of falling back to another field", () => {
    expect(toContainerSample({
      memory_stats: { usage: 1_000, stats: { total_inactive_file: 0, cache: 200 } },
    }).memUsed).toBe(1_000);
  });

  it("uses raw usage without a cache field or if cache is not less than usage", () => {
    for (const stats of [undefined, { cache: 1_000 }, { cache: 2_000 }]) {
      expect(toContainerSample({ memory_stats: { usage: 1_000, stats } }).memUsed).toBe(1_000);
    }
  });

  it("keeps a valid memory value when the other is missing", () => {
    expect(toContainerSample({ memory_stats: { usage: 0 } })).toMatchObject({
      memUsed: 0, memLimit: null, memPct: null,
    });
    expect(toContainerSample({ memory_stats: { limit: 2_000 } })).toMatchObject({
      memUsed: null, memLimit: 2_000, memPct: null,
    });
  });

  it.each([undefined, null, {}])("returns null metrics for missing stats: %j", (stats) => {
    expect(toContainerSample(stats, 123)).toEqual({
      ts: 123, cpu: null, memUsed: null, memLimit: null, memPct: null,
    });
  });

  it.each([-1, NaN, Infinity])("rejects invalid memory usage and limits: %s", (value) => {
    expect(toContainerSample({ memory_stats: { usage: value, limit: value } })).toMatchObject({
      memUsed: null, memLimit: null, memPct: null,
    });
    expect(toContainerSample({ memory_stats: { usage: 100, stats: { cache: value } } }).memUsed).toBeNull();
  });

  it("treats a zero limit as unknown", () => {
    expect(toContainerSample({ memory_stats: { usage: 100, limit: 0 } })).toMatchObject({
      memUsed: 100, memLimit: null, memPct: null,
    });
  });
});

describe("sumContainerSamples", () => {
  const first = { ts: 1, cpu: 25, memUsed: 100, memLimit: 200, memPct: 50 };
  const second = { ts: 2, cpu: 50, memUsed: 100, memLimit: 800, memPct: 12.5 };

  it("sums containers and recomputes memory percent from combined bytes", () => {
    expect(sumContainerSamples([first, second], 123)).toEqual({
      ts: 123, cpu: 75, memUsed: 200, memLimit: 1_000, memPct: 20,
    });
  });

  it("propagates unknown metrics independently", () => {
    expect(sumContainerSamples([first, { ...second, cpu: null }], 123)).toEqual({
      ts: 123, cpu: null, memUsed: 200, memLimit: 1_000, memPct: 20,
    });
    expect(sumContainerSamples([first, { ...second, memUsed: null }], 123)).toEqual({
      ts: 123, cpu: 75, memUsed: null, memLimit: 1_000, memPct: null,
    });
    expect(sumContainerSamples([first, { ...second, memLimit: null }], 123)).toEqual({
      ts: 123, cpu: 75, memUsed: 200, memLimit: null, memPct: null,
    });
  });

  it("returns unknown metrics for no containers", () => {
    expect(sumContainerSamples([], 123)).toEqual({
      ts: 123, cpu: null, memUsed: null, memLimit: null, memPct: null,
    });
  });

  it("rejects nonfinite aggregate values", () => {
    expect(sumContainerSamples([{ ...first, cpu: NaN }]).cpu).toBeNull();
    expect(sumContainerSamples([
      { ...first, memUsed: Number.MAX_VALUE },
      { ...second, memUsed: Number.MAX_VALUE },
    ]).memUsed).toBeNull();
  });
});
