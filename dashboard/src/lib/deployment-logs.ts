import "server-only";

import { request } from "./dokploy";

interface DeploymentLogMetadata {
  deploymentId: string;
  status: string;
}

export class DeploymentLogError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Read this deployment's build log, never a service's current container logs. */
export async function readFailedDeploymentLog(deploymentId: string): Promise<string> {
  if (!deploymentId.trim()) {
    throw new DeploymentLogError("Missing deployment ID.", 400);
  }

  // Dokploy filters this list by organization and the current user's service
  // access. Check the selected deployment's status, not the service's latest one.
  const deployments = await request<DeploymentLogMetadata[]>("deployment.allCentralized");
  const deployment = deployments.find((item) => item.deploymentId === deploymentId);
  if (!deployment) {
    throw new DeploymentLogError("Deployment not found.", 404);
  }
  if (deployment.status !== "error") {
    throw new DeploymentLogError("Diagnosis is available for failed deployments only.", 409);
  }

  // Verified against Dokploy v0.30.10: readLogs checks deployment read access,
  // resolves the deployment's stored logPath/server, and returns tail stdout.
  // A caller supplies only an ID; no filesystem path crosses this API boundary.
  const log = await request<string>(
    `deployment.readLogs?deploymentId=${encodeURIComponent(deploymentId)}&tail=10000`
  );
  if (typeof log !== "string" || !log.trim()) {
    throw new DeploymentLogError("Build log unavailable for this deployment.", 503);
  }
  return log;
}
