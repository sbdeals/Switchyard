import type { DeployCheckInput } from "./deploy-checks";

export interface DeployCheckSupport {
  healthcheck: boolean;
  preDeploy: boolean;
  reason: string | null;
}

export interface DeployCheckObservation {
  healthcheck: string;
  preDeploy: string;
}

/** Only inspect results from containers created for the latest deployment. */
export interface CheckContainer {
  serviceName: string;
  createdAt: string;
  state: string;
  health?: string;
  healthTest?: string[];
  healthRan: boolean;
  exitCode?: number;
  command?: string[];
  entrypoint?: string[];
}

export function applicationCheckSupport(manager: boolean, remote: boolean): DeployCheckSupport {
  return {
    healthcheck: manager && !remote,
    preDeploy: false,
    reason: remote
      ? "Not supported on this host: remote host capabilities cannot be verified."
      : manager
        ? "Pre-deploy commands are not supported for Dokploy applications. Use a raw Compose service."
        : "Not supported on this host: application healthchecks require a Swarm manager. Pre-deploy commands require a raw Compose service.",
  };
}

export function observeDeployChecks(
  checks: DeployCheckInput,
  containers: CheckContainer[],
  deployedAt: string | undefined,
  expectedTest: string[] | undefined,
): DeployCheckObservation {
  const since = Date.parse(deployedAt ?? "");
  const current = containers.filter((c) => Number.isFinite(since) && Date.parse(c.createdAt) >= since);
  const web = current.filter((c) => !checks.serviceName || c.serviceName === checks.serviceName);
  const matching = web.filter((c) => expectedTest && JSON.stringify(c.healthTest) === JSON.stringify(expectedTest));
  let healthcheck = checks.healthcheckPath ? "Not observed for this deployment" : "Not configured";
  if (checks.healthcheckPath && matching.length) {
    if (matching.some((c) => c.healthRan && c.health === "unhealthy")) healthcheck = "Unhealthy";
    else if (matching.length === web.length && matching.every((c) => c.state === "running" && c.healthRan && c.health === "healthy")) healthcheck = "Passed (HTTP 2xx)";
    else healthcheck = "Waiting for HTTP 2xx";
  }
  let preDeploy = checks.preDeployCommand ? "Not observed for this deployment" : "Not configured";
  const jobs = current.filter((c) => c.serviceName === "sy-predeploy"
    && JSON.stringify(c.entrypoint) === JSON.stringify(["/bin/sh", "-c"])
    && JSON.stringify(c.command) === JSON.stringify([checks.preDeployCommand]));
  if (checks.preDeployCommand && jobs.length) {
    if (jobs.some((c) => c.state === "exited" && c.exitCode !== 0)) preDeploy = "Failed — deploy aborted";
    else if (jobs.every((c) => c.state === "exited" && c.exitCode === 0)) preDeploy = "Passed (exit 0)";
    else preDeploy = "Waiting for command to complete";
  }
  return { healthcheck, preDeploy };
}
