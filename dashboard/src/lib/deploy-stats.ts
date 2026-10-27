import type { AppDeployment } from "./dokploy";

type DeploymentTiming = {
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isDeploymentRunning(deployment: DeploymentTiming): boolean {
  return deployment.status === "running" && deployment.finishedAt == null;
}

/** Never substitute creation time for a missing start or finish. */
export function getDeploymentDuration(deployment: DeploymentTiming, now: number): number | null {
  const start = timestamp(deployment.startedAt);
  const terminal = ["done", "error", "cancelled"].includes(deployment.status);
  const end = isDeploymentRunning(deployment)
    ? now
    : terminal ? timestamp(deployment.finishedAt) : null;
  if (start === null || end === null || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return "—";
  const seconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m ${seconds % 60}s`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function sortedDurations(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
}

export function median(values: readonly number[]): number | null {
  const sorted = sortedDurations(values);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Nearest-rank p90: a measured duration, including for small histories. */
export function p90(values: readonly number[]): number | null {
  const sorted = sortedDurations(values);
  return sorted.length ? sorted[Math.ceil(sorted.length * 0.9) - 1] : null;
}

/** Cancelled, queued, running and unknown statuses are not completed outcomes. */
export function successRate(deployments: readonly { status: string }[]): number | null {
  const completed = deployments.filter((deployment) => ["done", "error"].includes(deployment.status));
  return completed.length
    ? (completed.filter((deployment) => deployment.status === "done").length / completed.length) * 100
    : null;
}

export function sortDeployments(deployments: readonly AppDeployment[]): AppDeployment[] {
  return [...deployments].sort((a, b) =>
    (timestamp(b.createdAt) ?? -Infinity) - (timestamp(a.createdAt) ?? -Infinity)
  );
}

export function getDeployStats(deployments: readonly AppDeployment[]) {
  const recent = sortDeployments(deployments).slice(0, 20);
  const durations = recent
    .filter((deployment) => ["done", "error"].includes(deployment.status))
    .map((deployment) => getDeploymentDuration(deployment, 0))
    .filter((duration): duration is number => duration !== null);
  return {
    recent,
    successRate: successRate(recent),
    medianDurationMs: median(durations),
    p90DurationMs: p90(durations),
    lastSuccessful: recent.find((deployment) => deployment.status === "done") ?? null,
    durationCount: durations.length,
  };
}

export function formatRelativeTime(value: string | null | undefined, now: number): string {
  const time = timestamp(value);
  if (time === null || !Number.isFinite(now)) return "—";
  const seconds = Math.floor(Math.abs(now - time) / 1000);
  if (seconds < 1) return "just now";
  const units: [number, string][] = [[86400, "d"], [3600, "h"], [60, "m"], [1, "s"]];
  const [size, unit] = units.find(([size]) => seconds >= size)!;
  const relative = `${Math.floor(seconds / size)}${unit}`;
  return time > now ? `in ${relative}` : `${relative} ago`;
}

export function formatAbsoluteTime(value: string | null | undefined): string {
  const time = timestamp(value);
  // A fixed timezone also keeps server-rendered tooltips stable on hydration.
  return time === null ? "Time unavailable" : new Date(time).toISOString().replace("T", " ").replace("Z", " UTC");
}

/** Missing timing has no bar height; the UI renders an unavailable marker. */
export function durationBarHeight(durationMs: number | null, maxDurationMs: number, height = 32): number {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0 ||
    !Number.isFinite(maxDurationMs) || maxDurationMs <= 0) return 0;
  return Math.min(durationMs / maxDurationMs, 1) * height;
}
