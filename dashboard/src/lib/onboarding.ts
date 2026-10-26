import type { ProjectNode, Service, ServiceEdge } from "./dokploy";

export interface OnboardingItem {
  id: "project" | "service" | "domain" | "variable" | "environment";
  label: string;
  done: boolean;
  projectId?: string;
  serviceId?: string;
}

/** Keep the canvas, empty state and create flows in the same project scope. */
export function getWorkspaceScope(
  projects: readonly ProjectNode[],
  services: readonly Service[],
  edges: readonly ServiceEdge[],
  selectedProjectId: string | null,
) {
  const project = projects.find((p) => p.projectId === selectedProjectId) ?? null;
  const scopedServices = project
    ? services.filter((service) => service.projectId === project.projectId)
    : services.slice();
  const serviceIds = new Set(scopedServices.map((service) => service.id));
  return {
    project,
    projects: project ? [project] : projects.slice(),
    services: scopedServices,
    edges: edges.filter((edge) => serviceIds.has(edge.source) && serviceIds.has(edge.target)),
  };
}

function hasVariable(env: string | null): boolean {
  return (env ?? "").split("\n").some((line) => /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line.trim()));
}

/** Milestones come only from workspace records, never remembered click events. */
export function getOnboardingChecklist(projects: readonly ProjectNode[], services: readonly Service[]) {
  const firstProject = projects[0];
  const firstService = services[0];
  const deployed = services.find((service) =>
    service.status === "done" || service.runtime?.health === "running" ||
    (service.kind !== "database" && service.deployments.some((deployment) => deployment.status === "done")),
  );
  const domainService = services.find((service) =>
    service.kind !== "database" && service.domains.some((domain) => domain.host.trim().length > 0),
  );
  const domainTarget = domainService ?? services.find((service) => service.kind !== "database");
  const variableService = services.find((service) => hasVariable(service.env));
  const environmentProject = projects.find((project) =>
    new Set(project.environments.map((environment) => environment.environmentId)).size > 1,
  );
  const serviceTarget = deployed ?? firstService;
  const variableTarget = variableService ?? firstService;
  const items: OnboardingItem[] = [
    { id: "project", label: "Create a project", done: projects.length > 0, projectId: firstProject?.projectId },
    { id: "service", label: "Deploy your first service", done: !!deployed, projectId: serviceTarget?.projectId, serviceId: serviceTarget?.id },
    { id: "domain", label: "Add a domain", done: !!domainService, projectId: domainTarget?.projectId, serviceId: domainTarget?.id },
    { id: "variable", label: "Set a variable", done: !!variableService, projectId: variableTarget?.projectId, serviceId: variableTarget?.id },
    { id: "environment", label: "Add a second environment", done: !!environmentProject, projectId: (environmentProject ?? firstProject)?.projectId },
  ];
  const completedCount = items.filter((item) => item.done).length;
  return { items, completedCount, complete: completedCount === items.length };
}

type OnboardingStorage = Pick<Storage, "getItem" | "setItem">;

/** The caller supplies a hash of the email; never store the email itself. */
export function onboardingStorageKey(userId: string): string {
  return `switchyard:onboarding-dismissed:${userId}`;
}

export function isOnboardingDismissed(userId: string | null, storage?: OnboardingStorage): boolean {
  if (!userId) return false;
  try {
    return (storage ?? window.localStorage).getItem(onboardingStorageKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function dismissOnboarding(userId: string | null, storage?: OnboardingStorage): void {
  if (!userId) return;
  try {
    (storage ?? window.localStorage).setItem(onboardingStorageKey(userId), "1");
  } catch {
    // Dismissal still works for this view when browser storage is unavailable.
  }
}
