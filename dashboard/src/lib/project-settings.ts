export interface ProjectResource {
  id: string;
  name: string;
  kind: string;
  appName: string;
  status: string;
  running?: boolean;
}

export interface SettingsEnvironment {
  environmentId: string;
  name: string;
  isDefault: boolean;
  services: ProjectResource[];
}

export interface ProjectSettings {
  projectId: string;
  name: string;
  description: string;
  canDelete: boolean;
  environments: SettingsEnvironment[];
}

export function validateProjectDetails(name: unknown, description: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return "Enter a project name.";
  if (typeof description !== "string") return "Description must be text.";
  return null;
}

export function canRenameEnvironment(environment: Pick<SettingsEnvironment, "name" | "isDefault">): boolean {
  return !environment.isDefault && environment.name.trim().toLowerCase() !== "production";
}

export function validateEnvironmentName(
  environment: Pick<SettingsEnvironment, "name" | "isDefault">,
  name: unknown,
): string | null {
  if (!canRenameEnvironment(environment)) return "The production or default environment cannot be renamed.";
  if (typeof name !== "string" || !name.trim()) return "Enter an environment name.";
  return null;
}

export function projectResources(project: ProjectSettings) {
  return project.environments.flatMap((environment) =>
    environment.services.map((service) => ({
      ...service,
      environmentId: environment.environmentId,
      environmentName: environment.name,
    })),
  );
}

export function projectInventoryKey(project: ProjectSettings): string {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return JSON.stringify(project.environments.map((environment) => ({
    environmentId: environment.environmentId,
    name: environment.name,
    services: environment.services.map(({ kind, id, name }) => ({ kind, id, name }))
      .sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id)),
  })).sort((a, b) => compare(a.environmentId, b.environmentId)));
}

export function requiresRunningConfirmation(project: ProjectSettings, selectedProjectId: string | null): boolean {
  return project.projectId === selectedProjectId && projectResources(project).some((service) =>
    service.running ?? (service.status === "done" || service.status === "running"),
  );
}

export function validateProjectDeletion(
  project: ProjectSettings | undefined,
  typedName: unknown,
  selectedProjectId: string | null,
  acknowledged: unknown,
): string | null {
  if (!project) return "Project not found or access denied.";
  if (!project.canDelete) return "Only organization owners and admins can delete projects because members may not see every service.";
  if (typedName !== project.name) return "Type the exact project name to confirm deletion.";
  if (requiresRunningConfirmation(project, selectedProjectId) && acknowledged !== true) {
    return "Confirm that running services will be stopped.";
  }
  return null;
}

export function requireOwnedProject<T extends { projectId: string }>(projects: T[], projectId: string): T {
  const project = projects.find((candidate) => candidate.projectId === projectId);
  if (!project) throw new Error("Project not found or access denied.");
  return project;
}
