export const ACTIVITY_STATUSES = ["queued", "running", "done", "error", "cancelled"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export interface ActivityEntry {
  deploymentId: string;
  serviceId: string;
  serviceKind: "application" | "compose";
  serviceName: string;
  projectId: string;
  projectName: string;
  environmentName: string;
  status: ActivityStatus;
  title: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface ActivityDeployment {
  deploymentId: string;
  status?: string | null;
  title?: string | null;
  description?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface ActivityService {
  id: string;
  kind: "database" | "application" | "compose";
  name: string;
  projectId: string;
  projectName: string;
  environmentName: string;
  deployments?: readonly ActivityDeployment[];
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value: string | null | undefined): string | null {
  const parsed = timestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

/** Project only display fields; service details can contain credentials. */
export function normalizeActivity(services: readonly ActivityService[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const service of services) {
    if (service.kind === "database") continue;
    for (const deployment of service.deployments ?? []) {
      const status = ACTIVITY_STATUSES.find((value) => value === deployment.status) ?? "queued";
      entries.push({
        deploymentId: deployment.deploymentId,
        serviceId: service.id,
        serviceKind: service.kind,
        serviceName: service.name,
        projectId: service.projectId,
        projectName: service.projectName,
        environmentName: service.environmentName,
        status,
        title: deployment.title?.trim() || deployment.description?.trim() || "Deployment",
        startedAt: date(deployment.startedAt) ?? date(deployment.createdAt),
        finishedAt: date(deployment.finishedAt),
      });
    }
  }
  return sortActivity(entries);
}

/** Compare instants, not timestamp strings: Dokploy may return timezone offsets. */
export function sortActivity(entries: readonly ActivityEntry[]): ActivityEntry[] {
  return [...entries].sort((a, b) => {
    const left = timestamp(a.startedAt);
    const right = timestamp(b.startedAt);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return right - left;
  });
}

export function filterActivity(
  entries: readonly ActivityEntry[],
  filters: { projectId?: string; status?: ActivityStatus | "all" },
): ActivityEntry[] {
  return entries.filter((entry) =>
    (!filters.projectId || entry.projectId === filters.projectId) &&
    (!filters.status || filters.status === "all" || entry.status === filters.status),
  );
}

export function formatActivityDuration(
  entry: Pick<ActivityEntry, "status" | "startedAt" | "finishedAt">,
  now = Date.now(),
): string {
  if (entry.status === "queued") return "—";
  const start = timestamp(entry.startedAt);
  const end = entry.status === "running" ? now : timestamp(entry.finishedAt);
  // A completed deployment without a finish time must not keep counting upward.
  if (start === null || end === null || !Number.isFinite(end) || end < start) return "—";
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatActivityTime(startedAt: string | null, now = Date.now()): string {
  const start = timestamp(startedAt);
  if (start === null || !Number.isFinite(now)) return "Unknown time";
  const seconds = Math.floor(Math.abs(now - start) / 1000);
  if (seconds < 5) return "just now";
  const value = seconds < 60 ? `${seconds}s`
    : seconds < 3600 ? `${Math.floor(seconds / 60)}m`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h`
    : `${Math.floor(seconds / 86400)}d`;
  return start > now ? `in ${value}` : `${value} ago`;
}
