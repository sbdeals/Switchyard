import "server-only";

import { request } from "./dokploy";
import { listRuntimeStates } from "./docker";
import {
  projectInventoryKey,
  projectResources,
  requireOwnedProject,
  validateEnvironmentName,
  validateProjectDeletion,
  validateProjectDetails,
  type ProjectSettings,
} from "./project-settings";

// Dokploy v0.30.10 project.one includes these summaries, without DB credentials.
const resourceTypes = [
  ["applications", "application", "applicationId", "delete"],
  ["compose", "compose", "composeId", "delete"],
  ["postgres", "postgres", "postgresId", "remove"],
  ["mysql", "mysql", "mysqlId", "remove"],
  ["mariadb", "mariadb", "mariadbId", "remove"],
  ["mongo", "mongo", "mongoId", "remove"],
  ["redis", "redis", "redisId", "remove"],
  ["libsql", "libsql", "libsqlId", "remove"],
] as const;

type ResourceSummary = Record<string, string>;
type EnvironmentSummary = {
  environmentId: string;
  name: string;
  isDefault: boolean;
} & Partial<Record<(typeof resourceTypes)[number][0], ResourceSummary[]>>;
interface ProjectSummary {
  projectId: string;
  name: string;
  description?: string | null;
  environments: EnvironmentSummary[];
}

async function ownedProject(projectId: string) {
  // Always use the caller's fresh project.all, never the system probe session.
  const projects = await request<ProjectSummary[]>("project.all");
  return requireOwnedProject(projects, projectId);
}

export async function getProjectSettings(projectId: string): Promise<ProjectSettings> {
  await ownedProject(projectId);
  const [project, member] = await Promise.all([
    request<ProjectSummary>(`project.one?projectId=${encodeURIComponent(projectId)}`),
    request<{ role: string }>("user.get"),
  ]);
  const result: ProjectSettings = {
    projectId: project.projectId,
    name: project.name,
    description: project.description ?? "",
    // Members' inventories may hide services that project.remove would delete.
    canDelete: member.role === "owner" || member.role === "admin",
    environments: project.environments.map((environment) => ({
      environmentId: environment.environmentId,
      name: environment.name,
      isDefault: environment.isDefault,
      services: resourceTypes.flatMap(([collection, kind, idKey]) =>
        (environment[collection] ?? []).map((service) => ({
          id: service[idKey],
          name: service.name ?? service[idKey],
          kind,
          appName: service.appName ?? "",
          status: (kind === "compose" ? service.composeStatus : service.applicationStatus) ?? "idle",
        })),
      ),
    })),
  };
  const remoteServices = new Set(project.environments.flatMap((environment) =>
    resourceTypes.flatMap(([collection]) => (environment[collection] ?? [])
      .filter((service) => service.serverId)
      .map((service) => service.appName)),
  ));
  try {
    const runtime = await listRuntimeStates();
    for (const environment of result.environments) {
      for (const service of environment.services) {
        if (!service.appName || remoteServices.has(service.appName)) continue;
        const states = service.kind === "compose" ? runtime.compose : runtime.swarm;
        if (states.has(service.appName)) service.running = states.get(service.appName)!.includes("running");
      }
    }
  } catch {
    // Without the Docker socket the confirmation uses Dokploy's deploy status.
  }
  return result;
}

export async function updateProjectSettings(projectId: string, name: string, description: string): Promise<void> {
  const error = validateProjectDetails(name, description);
  if (error) throw new Error(error);
  await ownedProject(projectId);
  await request("project.update", { method: "POST", body: { projectId, name: name.trim(), description } });
}

export async function updateProjectEnvironment(environmentId: string, name: string): Promise<void> {
  const projects = await request<ProjectSummary[]>("project.all");
  const environment = projects.flatMap((project) => project.environments)
    .find((candidate) => candidate.environmentId === environmentId);
  if (!environment) throw new Error("Environment not found or access denied.");
  const error = validateEnvironmentName(environment, name);
  if (error) throw new Error(error);
  await request("environment.update", { method: "POST", body: { environmentId, name: name.trim() } });
}

export async function deleteProjectSettings(
  projectId: string,
  typedName: string,
  selectedProjectId: string | null,
  acknowledged: boolean,
  reviewedInventory: string,
): Promise<void> {
  const project = await getProjectSettings(projectId);
  const error = validateProjectDeletion(project, typedName, selectedProjectId, acknowledged);
  if (error) throw new Error(error);
  if (projectInventoryKey(project) !== reviewedInventory) {
    throw new Error("Project services changed. Review the list and confirm deletion again.");
  }

  // project.remove only cascades database records in v0.30.10. Remove services
  // with Dokploy's own cleanup endpoints first, as its project UI requires.
  for (const service of projectResources(project)) {
    const [, kind, idKey, procedure] = resourceTypes.find(([, kind]) => kind === service.kind)!;
    await request(`${kind}.${procedure}`, {
      method: "POST",
      body: { [idKey]: service.id, ...(kind === "compose" ? { deleteVolumes: false } : {}) },
    });
  }
  // If another user added a service while cleanup ran, preserve the project.
  const remaining = await getProjectSettings(projectId);
  const confirmationError = validateProjectDeletion(remaining, typedName, selectedProjectId, acknowledged);
  if (confirmationError) throw new Error(confirmationError);
  if (projectResources(remaining).length) {
    throw new Error("Project services changed during deletion. Review the remaining services and try again.");
  }
  await request("project.remove", { method: "POST", body: { projectId } });
}
