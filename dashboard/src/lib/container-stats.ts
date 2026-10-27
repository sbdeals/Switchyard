/** The fields needed from Docker's container stats response. */
interface CpuStats {
  cpu_usage?: {
    total_usage?: number | null;
    percpu_usage?: number[] | null;
  } | null;
  system_cpu_usage?: number | null;
  online_cpus?: number | null;
}

export interface DockerStats {
  cpu_stats?: CpuStats | null;
  precpu_stats?: CpuStats | null;
  memory_stats?: {
    usage?: number | null;
    limit?: number | null;
    stats?: {
      total_inactive_file?: number | null;
      inactive_file?: number | null;
      cache?: number | null;
    } | null;
  } | null;
}

export interface ContainerSample {
  ts: number;
  /** Docker CPU percent: 100% is one fully occupied CPU. */
  cpu: number | null;
  memUsed: number | null;
  memLimit: number | null;
  memPct: number | null;
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function cpuPercent(stats: DockerStats): number | null {
  const current = stats.cpu_stats;
  const previous = stats.precpu_stats;
  const used = current?.cpu_usage?.total_usage;
  const previousUsed = previous?.cpu_usage?.total_usage;
  const system = current?.system_cpu_usage;
  const previousSystem = previous?.system_cpu_usage;
  const online = current?.online_cpus;
  const cpus = online == null || online === 0
    ? current?.cpu_usage?.percpu_usage?.length
    : online;
  if (!nonnegative(used) || !nonnegative(previousUsed) ||
      !nonnegative(system) || !nonnegative(previousSystem) ||
      !nonnegative(cpus) || cpus === 0 || !Number.isInteger(cpus)) return null;

  const cpuDelta = used - previousUsed;
  const systemDelta = system - previousSystem;
  if (cpuDelta < 0 || systemDelta <= 0) return null;
  const percent = (cpuDelta / systemDelta) * cpus * 100;
  return nonnegative(percent) ? percent : null;
}

function memoryPercent(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null || limit <= 0) return null;
  const percent = (used / limit) * 100;
  return nonnegative(percent) ? percent : null;
}

/** Apply Docker's CPU delta and Linux memory-minus-cache calculations. */
export function toContainerSample(stats: DockerStats | null | undefined, ts = Date.now()): ContainerSample {
  const memory = stats?.memory_stats;
  const usage = memory?.usage;
  const cache = memory?.stats?.total_inactive_file
    ?? memory?.stats?.inactive_file
    ?? memory?.stats?.cache
    ?? 0;
  // Docker keeps usage unchanged if the reported cache exceeds usage.
  const memUsed = nonnegative(usage) && nonnegative(cache)
    ? usage - (cache < usage ? cache : 0)
    : null;
  const memLimit = nonnegative(memory?.limit) && memory.limit > 0 ? memory.limit : null;
  return {
    ts,
    cpu: stats ? cpuPercent(stats) : null,
    memUsed,
    memLimit,
    memPct: memoryPercent(memUsed, memLimit),
  };
}

/** Keep an incomplete container measurement from appearing as a valid total. */
export function sumContainerSamples(samples: ContainerSample[], ts = Date.now()): ContainerSample {
  const sum = (field: "cpu" | "memUsed" | "memLimit"): number | null => {
    if (samples.length === 0) return null;
    let total = 0;
    for (const sample of samples) {
      const value = sample[field];
      if (!nonnegative(value)) return null;
      total += value;
    }
    return nonnegative(total) ? total : null;
  };
  const memUsed = sum("memUsed");
  const memLimit = sum("memLimit");
  return {
    ts,
    cpu: sum("cpu"),
    memUsed,
    memLimit,
    memPct: memoryPercent(memUsed, memLimit),
  };
}
