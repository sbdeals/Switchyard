import { describe, expect, it } from "vitest";
import type { ComposeService, Database, ProjectNode } from "./dokploy";
import { redactServiceForClient } from "./service-redaction";
import { dismissOnboarding, getOnboardingChecklist, getWorkspaceScope, isOnboardingDismissed, onboardingStorageKey } from "./onboarding";

function project(projectId = "project-1", environmentIds = ["production"]): ProjectNode {
  return { projectId, name: projectId, environments: environmentIds.map((environmentId) => ({ environmentId, name: environmentId })) };
}

function database(overrides: Partial<Database> = {}): Database {
  return {
    kind: "database", id: "db-1", name: "Database", appName: "database", status: "idle",
    projectId: "project-1", projectName: "Project", environmentId: "production", environmentName: "Production",
    dockerImage: null, env: null, createdAt: null, cpuLimit: null, memoryLimit: null, replicas: null,
    engine: "postgres", databaseName: null, databaseUser: null, databasePassword: null, externalPort: null, command: null,
    ...overrides,
  };
}

function compose(overrides: Partial<ComposeService> = {}): ComposeService {
  return { ...database(), kind: "compose", id: "compose-1", composeFile: null, composeType: null, domains: [], deployments: [], ...overrides };
}

describe("getOnboardingChecklist", () => {
  it("starts with five incomplete milestones in a new workspace", () => {
    const state = getOnboardingChecklist([], []);
    expect(state.items.map((item) => item.id)).toEqual(["project", "service", "domain", "variable", "environment"]);
    expect(state.items.every((item) => !item.done && !item.projectId && !item.serviceId)).toBe(true);
    expect(state.completedCount).toBe(0);
    expect(state.complete).toBe(false);
  });

  it("counts creating an empty project without counting its default environment", () => {
    const state = getOnboardingChecklist([project()], []);
    expect(state.completedCount).toBe(1);
    expect(state.items.find((item) => item.id === "project")).toMatchObject({ done: true, projectId: "project-1" });
    expect(state.items.find((item) => item.id === "environment")).toMatchObject({ done: false, projectId: "project-1" });
  });

  it.each(["idle", "running", "error"] as const)("does not count a %s service as successfully deployed", (status) => {
    expect(getOnboardingChecklist([], [database({ status })]).items[1].done).toBe(false);
  });

  it("counts successful deployment, engine runtime or successful deployment history", () => {
    const services = [
      database({ status: "done", runtime: { health: "not-running", running: 0, total: 0 } }),
      database({ runtime: { health: "running", running: 1, total: 1 } }),
      compose({ status: "error", deployments: [{ deploymentId: "deploy-1", status: "done", title: "Deploy", createdAt: "", rollbackId: null }] }),
    ];
    for (const service of services) {
      expect(getOnboardingChecklist([], [service]).items[1]).toMatchObject({ done: true, serviceId: service.id });
    }
  });

  it("does not count failed deployment history or degraded runtime", () => {
    const service = compose({
      status: "error", runtime: { health: "degraded", running: 1, total: 2 },
      deployments: [{ deploymentId: "deploy-1", status: "error", title: "Deploy", createdAt: "", rollbackId: null }],
    });
    expect(getOnboardingChecklist([], [service]).items[1].done).toBe(false);
  });

  it.each([null, "", " \n\t", "# KEY=value\n  # ANOTHER=value", "not an assignment", "=value", "1KEY=value"])("ignores non-variable env content %j", (env) => {
    expect(getOnboardingChecklist([], [redactServiceForClient(database({ env }))]).items[3].done).toBe(false);
  });

  it.each(["KEY=value", "EMPTY=", " # comment\n KEY = value\n", "export KEY=value"])("counts a saved variable in %j", (env) => {
    expect(getOnboardingChecklist([], [redactServiceForClient(database({ env }))]).items[3]).toMatchObject({ done: true, serviceId: "db-1" });
  });

  it("requires two distinct environments in the same project", () => {
    expect(getOnboardingChecklist([project("one"), project("two")], []).items[4].done).toBe(false);
    expect(getOnboardingChecklist([project("one", ["production", "production"])], []).items[4].done).toBe(false);
    expect(getOnboardingChecklist([project("one"), project("two", ["production", "staging"])], []).items[4]).toMatchObject({ done: true, projectId: "two" });
  });

  it("links incomplete domain and variable milestones to suitable existing services", () => {
    const state = getOnboardingChecklist([project()], [database(), compose()]);
    expect(state.items[2]).toMatchObject({ done: false, serviceId: "compose-1", projectId: "project-1" });
    expect(state.items[3]).toMatchObject({ done: false, serviceId: "db-1", projectId: "project-1" });
    expect(getOnboardingChecklist([project()], [database()]).items[2].serviceId).toBeUndefined();
  });

  it("completes all milestones from live records and reflects their removal", () => {
    const service = compose({
      status: "done", env: "GREETING=hello",
      domains: [{ domainId: "domain-1", host: "example.test", https: false, port: 80, path: null, certificateType: "none", serviceName: "web" }],
    });
    const state = getOnboardingChecklist([project("project-1", ["production", "staging"])], [redactServiceForClient(service)]);
    expect(state.completedCount).toBe(5);
    expect(state.complete).toBe(true);
    expect(state.items[2]).toMatchObject({ done: true, serviceId: "compose-1" });
    expect(getOnboardingChecklist([project()], []).completedCount).toBe(1);
  });
});

describe("getWorkspaceScope", () => {
  const projects = [project("empty"), project("populated")];
  const services = [database({ id: "one", projectId: "populated" }), compose({ id: "two", projectId: "populated" })];
  const edges = [{ source: "one", target: "two" }, { source: "one", target: "missing" }];

  it("shows the selected empty project even when another project has services", () => {
    const scope = getWorkspaceScope(projects, services, edges, "empty");
    expect(scope.project?.projectId).toBe("empty");
    expect(scope.projects).toEqual([projects[0]]);
    expect(scope.services).toEqual([]);
    expect(scope.edges).toEqual([]);
  });

  it("limits deploy environments, services and edges to the selected project", () => {
    const scope = getWorkspaceScope(projects, [...services, database({ id: "other", projectId: "empty" })], [
      ...edges, { source: "one", target: "other" },
    ], "populated");
    expect(scope.projects).toEqual([projects[1]]);
    expect(scope.services).toEqual(services);
    expect(scope.edges).toEqual([edges[0]]);
  });

  it.each([null, "deleted"])("falls back to the whole workspace for selection %j", (selectedProjectId) => {
    const scope = getWorkspaceScope(projects, services, edges, selectedProjectId);
    expect(scope.project).toBeNull();
    expect(scope.projects).toEqual(projects);
    expect(scope.services).toEqual(services);
    expect(scope.edges).toEqual([edges[0]]);
  });
});

describe("onboarding dismissal", () => {
  it("persists dismissal per hashed user without affecting another user", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(isOnboardingDismissed("hash-one", storage)).toBe(false);
    dismissOnboarding("hash-one", storage);
    expect(isOnboardingDismissed("hash-one", storage)).toBe(true);
    expect(isOnboardingDismissed("hash-two", storage)).toBe(false);
    expect([...values.keys()]).toEqual([onboardingStorageKey("hash-one")]);
    dismissOnboarding(null, storage);
    expect(isOnboardingDismissed(null, storage)).toBe(false);
    expect(values.size).toBe(1);
  });

  it("stays usable when storage is blocked or no browser exists", () => {
    const storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(isOnboardingDismissed("hash-one", storage)).toBe(false);
    expect(() => dismissOnboarding("hash-one", storage)).not.toThrow();
    expect(isOnboardingDismissed("hash-one")).toBe(false);
    expect(() => dismissOnboarding("hash-one")).not.toThrow();
  });
});
