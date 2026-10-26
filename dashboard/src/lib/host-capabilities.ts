export interface HostCapabilities {
  mode: "bridge" | "swarm" | "worker" | "unknown";
  dokployVersion: string | null;
}

export type HostFeature =
  | "compose"
  | "nativeApplication"
  | "replicas"
  | "swarmHealthcheck"
  | "schedules"
  | "s3Backups";

export interface DockerSwarmState {
  LocalNodeState?: string;
  ControlAvailable?: boolean;
}

/** Only an active manager can create or update Swarm services. */
export function hostModeFromSwarm(
  swarm: DockerSwarmState | null | undefined,
): HostCapabilities["mode"] {
  if (swarm?.LocalNodeState === "active") {
    if (swarm.ControlAvailable === true) return "swarm";
    if (swarm.ControlAvailable === false) return "worker";
  }
  if (swarm?.LocalNodeState === "inactive" && swarm.ControlAvailable === false) {
    return "bridge";
  }
  return "unknown";
}

// These names describe the features currently exposed by this dashboard.
// In Dokploy v0.30.10, application schedules and native database S3 backups
// locate containers by com.docker.swarm.service.name. Upstream Compose
// schedules/backups support bridge containers and must not use these gates.
// https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/schedules/utils.ts
// https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/backups/utils.ts
const requiresSwarm: Record<HostFeature, boolean> = {
  compose: false,
  nativeApplication: true,
  replicas: true,
  swarmHealthcheck: true,
  schedules: true,
  s3Backups: true,
};

/** A known blocker, or null. Missing socket access must not prevent deployment. */
export function featureUnavailableReason(
  host: HostCapabilities,
  feature: HostFeature,
): string | null {
  if (!requiresSwarm[feature] || host.mode === "swarm") return null;
  if (host.mode === "bridge") {
    return "Needs Docker Swarm — this host runs in bridge mode. Use a Compose service instead.";
  }
  if (host.mode === "worker") {
    return "Needs a Docker Swarm manager — this host is a Swarm worker.";
  }
  return null;
}
