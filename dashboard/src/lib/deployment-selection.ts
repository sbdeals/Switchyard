import type { AppDeployment, ServiceKind } from "./dokploy";

interface DeploymentLogService {
  id: string;
  kind: ServiceKind;
  deployments?: readonly AppDeployment[];
}

/** Resolve only a deployment belonging to the requested, visible service. */
export function deploymentForService(
  services: readonly DeploymentLogService[],
  serviceId: string,
  deploymentId: string
): AppDeployment | null {
  const service = services.find((candidate) => candidate.id === serviceId);
  if (!service || service.kind === "database") return null;
  return service.deployments?.find((deployment) => deployment.deploymentId === deploymentId) ?? null;
}
