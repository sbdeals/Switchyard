export type DeploymentStatus = "done" | "error" | "cancelled";

export interface DeploymentSnapshot {
  deploymentId: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface DeploymentServiceSnapshot {
  id: string;
  name: string;
  projectId: string;
  kind: string;
  createdAt?: string | null;
  deployments?: DeploymentSnapshot[];
}

export interface DeploymentEvent {
  id: string;
  serviceId: string;
  serviceKind: string;
  serviceName: string;
  projectId: string;
  deploymentId: string;
  status: DeploymentStatus;
  durationMs: number | null;
  finishedAt: string;
  read: boolean;
}

export interface DeploymentTracker {
  observedAt: number;
  services: Map<string, { observedAt: number; deployments: Map<string, boolean> }>;
}

function serviceKey(projectId: string, kind: string, id: string): string {
  return JSON.stringify([projectId, kind, id]);
}

function eventId(event: Pick<DeploymentEvent, "projectId" | "serviceKind" | "serviceId" | "deploymentId">): string {
  return JSON.stringify([event.projectId, event.serviceKind, event.serviceId, event.deploymentId]);
}

function terminalStatus(status: string): DeploymentStatus | null {
  if (status === "canceled") return "cancelled";
  return status === "done" || status === "error" || status === "cancelled" ? status : null;
}

function timestamp(value: string | null | undefined): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Seed existing history quietly, then report each deployment's completion once. */
export function detectDeploymentEvents(
  previous: DeploymentTracker | null,
  services: DeploymentServiceSnapshot[],
  now: number,
): { tracker: DeploymentTracker; events: DeploymentEvent[] } {
  const tracker: DeploymentTracker = {
    observedAt: previous?.observedAt ?? now,
    services: new Map(previous?.services),
  };
  const events: DeploymentEvent[] = [];

  for (const service of services) {
    // An unavailable detail response must not count as an empty baseline.
    if (!service.deployments) continue;
    const key = serviceKey(service.projectId, service.kind, service.id);
    const known = tracker.services.get(key);
    const deployments = new Map(known?.deployments);
    const serviceCreatedAt = timestamp(service.createdAt);
    // A service created during this session can finish its first deployment
    // between polls. Existing services that become visible still seed quietly.
    const newlyCreated = previous !== null && serviceCreatedAt !== null && serviceCreatedAt >= tracker.observedAt;

    for (const deployment of service.deployments) {
      const status = terminalStatus(deployment.status);
      const completed = deployments.get(deployment.deploymentId);
      const createdAt = timestamp(deployment.createdAt);
      // Unknown terminal rows can be fast deployments between polls, or old
      // history appearing later. Only the former should produce a notification.
      const newlyCompleted = (known || newlyCreated) && status && completed !== true && (
        completed === false || (createdAt !== null && createdAt >= (known?.observedAt ?? tracker.observedAt))
      );

      if (newlyCompleted) {
        const finishedAt = timestamp(deployment.finishedAt) ?? now;
        const startedAt = timestamp(deployment.startedAt) ?? createdAt;
        const event: DeploymentEvent = {
          id: "",
          serviceId: service.id,
          serviceKind: service.kind,
          serviceName: service.name,
          projectId: service.projectId,
          deploymentId: deployment.deploymentId,
          status,
          durationMs: startedAt !== null && finishedAt >= startedAt ? finishedAt - startedAt : null,
          finishedAt: new Date(finishedAt).toISOString(),
          read: false,
        };
        event.id = eventId(event);
        events.push(event);
      }

      // Terminal IDs stay completed even if a stale response says running.
      deployments.set(deployment.deploymentId, completed === true || status !== null);
    }

    tracker.services.set(key, { observedAt: known?.observedAt ?? now, deployments });
  }

  return { tracker, events };
}

export function mergeActivity(previous: DeploymentEvent[], events: DeploymentEvent[]): DeploymentEvent[] {
  const unique = new Map(previous.map((event) => [event.id, event]));
  for (const event of events) {
    if (!unique.has(event.id)) unique.set(event.id, event);
  }
  return [...unique.values()]
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, 20);
}

export function markAllRead(activity: DeploymentEvent[]): DeploymentEvent[] {
  return activity.map((event) => event.read ? event : { ...event, read: true });
}

export function eventsForProject(events: DeploymentEvent[], projectId: string | null): DeploymentEvent[] {
  return projectId === null ? events : events.filter((event) => event.projectId === projectId);
}

/** Stored activity is only visible while its service remains accessible. */
export function visibleActivity(events: DeploymentEvent[], services: DeploymentServiceSnapshot[]): DeploymentEvent[] {
  const accessible = new Map(services.map((service) => [serviceKey(service.projectId, service.kind, service.id), service]));
  return events.flatMap((event) => {
    const service = accessible.get(serviceKey(event.projectId, event.serviceKind, event.serviceId));
    return service ? [{ ...event, serviceName: service.name }] : [];
  });
}

export function parseStoredActivity(value: string | null): DeploymentEvent[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((item): item is DeploymentEvent => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const event = item as Record<string, unknown>;
      if (!["id", "serviceId", "serviceKind", "serviceName", "projectId", "deploymentId", "finishedAt"]
        .every((key) => typeof event[key] === "string" && event[key] !== "")) return false;
      if (event.status !== "done" && event.status !== "error" && event.status !== "cancelled") return false;
      if (typeof event.read !== "boolean") return false;
      if (event.durationMs !== null && (typeof event.durationMs !== "number" || !Number.isFinite(event.durationMs) || event.durationMs < 0)) return false;
      if (timestamp(event.finishedAt as string) === null) return false;
      return event.id === eventId(item as DeploymentEvent);
    });
    return mergeActivity([], valid);
  } catch {
    return [];
  }
}

export function deploymentStatusLabel(status: DeploymentStatus): string {
  return { done: "Succeeded", error: "Failed", cancelled: "Cancelled" }[status];
}

export function formatDeploymentDuration(durationMs: number | null): string {
  if (durationMs === null) return "Duration unavailable";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
