import { describe, expect, it } from "vitest";
import {
  canRenameEnvironment,
  projectInventoryKey,
  projectResources,
  requireOwnedProject,
  requiresRunningConfirmation,
  validateEnvironmentName,
  validateProjectDeletion,
  validateProjectDetails,
  type ProjectResource,
  type ProjectSettings,
} from "./project-settings";

function resource(overrides: Partial<ProjectResource> = {}): ProjectResource {
  return { id: "app-1", name: "Website", kind: "application", appName: "website-1", status: "idle", ...overrides };
}

function project(services: ProjectResource[] = []): ProjectSettings {
  return {
    projectId: "project-1",
    name: "My project",
    description: "A test project",
    canDelete: true,
    environments: [{ environmentId: "env-1", name: "production", isDefault: true, services }],
  };
}

describe("project details", () => {
  it.each([undefined, null, 123, "", " \t\n "])("rejects invalid project name %s", (name) => {
    expect(validateProjectDetails(name, "Description")).toBe("Enter a project name.");
  });

  it.each([undefined, null, 123, {}])("rejects a non-text description %s", (description) => {
    expect(validateProjectDetails("My project", description)).toBe("Description must be text.");
  });

  it("allows an empty description and does not impose arbitrary length limits", () => {
    expect(validateProjectDetails(" My project ", "")).toBeNull();
    expect(validateProjectDetails("x".repeat(1000), "y".repeat(10000))).toBeNull();
  });
});

describe("environment names", () => {
  it.each([
    { name: "production", isDefault: false },
    { name: " PrOdUcTiOn ", isDefault: false },
    { name: "main", isDefault: true },
  ])("protects the production or default environment: %s", (environment) => {
    expect(canRenameEnvironment(environment)).toBe(false);
    expect(validateEnvironmentName(environment, "staging")).toBe("The production or default environment cannot be renamed.");
  });

  it.each([undefined, null, 123, "", " \n"])("rejects invalid environment name %s", (name) => {
    expect(validateEnvironmentName({ name: "preview", isDefault: false }, name)).toBe("Enter an environment name.");
  });

  it("allows renaming a non-production environment", () => {
    const environment = { name: "preview", isDefault: false };
    expect(canRenameEnvironment(environment)).toBe(true);
    expect(validateEnvironmentName(environment, " staging ")).toBeNull();
  });
});

describe("project resources", () => {
  it("lists every service and database across environments with environment labels", () => {
    const kinds = ["application", "compose", "postgres", "mysql", "mariadb", "mongo", "redis", "libsql"];
    const settings = project(kinds.map((kind) => resource({ id: kind, name: kind, kind })));
    settings.environments.push({
      environmentId: "env-2", name: "preview", isDefault: false,
      services: [resource({ id: "preview-app", name: "Preview website" })],
    });

    const resources = projectResources(settings);
    expect(resources).toHaveLength(9);
    expect(resources.slice(0, 8).map((service) => service.kind)).toEqual(kinds);
    expect(resources[0]).toMatchObject({ environmentId: "env-1", environmentName: "production" });
    expect(resources[8]).toMatchObject({ id: "preview-app", environmentId: "env-2", environmentName: "preview" });
    expect(settings.environments[0].services[0]).not.toHaveProperty("environmentId");
  });

  it("handles projects without environments or services", () => {
    expect(projectResources(project())).toEqual([]);
    expect(projectResources({ ...project(), environments: [] })).toEqual([]);
  });
});

describe("reviewed project inventory", () => {
  it("ignores environment and resource ordering without mutating the input", () => {
    const settings = project([resource(), resource({ id: "app-2", name: "Worker" })]);
    settings.environments.push({
      environmentId: "env-2", name: "preview", isDefault: false,
      services: [resource({ id: "db-1", kind: "libsql", name: "Preview database" })],
    });
    const reordered = structuredClone(settings);
    reordered.environments.reverse();
    reordered.environments[1].services.reverse();

    expect(projectInventoryKey(settings)).toBe(projectInventoryKey(reordered));
    expect(reordered.environments[0].environmentId).toBe("env-2");
    expect(reordered.environments[1].services[0].id).toBe("app-2");
  });

  it("ignores deployment status, runtime, description, and unrelated metadata", () => {
    const settings = project([resource()]);
    const changed = structuredClone(settings);
    changed.description = "New description";
    changed.canDelete = false;
    Object.assign(changed.environments[0].services[0], { status: "done", running: true, appName: "different-runtime-name" });

    expect(projectInventoryKey(changed)).toBe(projectInventoryKey(settings));
  });

  it.each([
    ["added service", (settings: ProjectSettings) => settings.environments[0].services.push(resource({ id: "new-app" }))],
    ["removed service", (settings: ProjectSettings) => settings.environments[0].services.pop()],
    ["renamed service", (settings: ProjectSettings) => { settings.environments[0].services[0].name = "Renamed"; }],
    ["changed service ID", (settings: ProjectSettings) => { settings.environments[0].services[0].id = "replacement-app"; }],
    ["changed service kind", (settings: ProjectSettings) => { settings.environments[0].services[0].kind = "compose"; }],
    ["renamed environment", (settings: ProjectSettings) => { settings.environments[0].name = "preview"; }],
    ["changed environment ID", (settings: ProjectSettings) => { settings.environments[0].environmentId = "replacement-env"; }],
    ["new empty environment", (settings: ProjectSettings) => settings.environments.push({
      environmentId: "env-2", name: "preview", isDefault: false, services: [],
    })],
  ] as const)("invalidates confirmation after a %s", (_label, change) => {
    const settings = project([resource()]);
    const changed = structuredClone(settings);
    change(changed);
    expect(projectInventoryKey(changed)).not.toBe(projectInventoryKey(settings));
  });

  it("invalidates confirmation when a resource moves between existing environments", () => {
    const settings = project([resource()]);
    settings.environments.push({ environmentId: "env-2", name: "preview", isDefault: false, services: [] });
    const changed = structuredClone(settings);
    changed.environments[1].services.push(changed.environments[0].services.pop()!);
    expect(projectInventoryKey(changed)).not.toBe(projectInventoryKey(settings));
  });
});

describe("running service confirmation", () => {
  it("requires confirmation only for the selected project", () => {
    const settings = project([resource({ running: true })]);
    expect(requiresRunningConfirmation(settings, settings.projectId)).toBe(true);
    expect(requiresRunningConfirmation(settings, "another-project")).toBe(false);
    expect(requiresRunningConfirmation(settings, null)).toBe(false);
  });

  it.each(["done", "running"])("falls back to %s when runtime status is unavailable", (status) => {
    const settings = project([resource({ status })]);
    expect(requiresRunningConfirmation(settings, settings.projectId)).toBe(true);
  });

  it("uses runtime state ahead of recorded deployment status", () => {
    expect(requiresRunningConfirmation(project([resource({ status: "done", running: false })]), "project-1")).toBe(false);
    expect(requiresRunningConfirmation(project([resource({ status: "error", running: true })]), "project-1")).toBe(true);
  });

  it("includes running databases in other environments", () => {
    const settings = project();
    settings.environments.push({
      environmentId: "env-2", name: "preview", isDefault: false,
      services: [resource({ kind: "libsql", running: true })],
    });
    expect(requiresRunningConfirmation(settings, settings.projectId)).toBe(true);
  });

  it.each(["idle", "error", "building", "stopped"])("does not require confirmation for %s services", (status) => {
    expect(requiresRunningConfirmation(project([resource({ status })]), "project-1")).toBe(false);
  });

  it("does not require confirmation for an empty project", () => {
    expect(requiresRunningConfirmation(project(), "project-1")).toBe(false);
  });
});

describe("project deletion", () => {
  it("rejects a project missing from the current ownership list", () => {
    expect(validateProjectDeletion(undefined, "My project", null, true)).toBe("Project not found or access denied.");
  });

  it("rejects deletion for members whose resource inventory may be incomplete", () => {
    const settings = { ...project(), canDelete: false };
    expect(validateProjectDeletion(settings, settings.name, null, true))
      .toBe("Only organization owners and admins can delete projects because members may not see every service.");
  });

  it.each([undefined, null, 123, "", "my project", " My project", "My project ", "Old project name"])(
    "requires the exact current name instead of %s", (name) => {
      expect(validateProjectDeletion(project(), name, null, true)).toBe("Type the exact project name to confirm deletion.");
    },
  );

  it("rejects stale confirmation after the project is renamed", () => {
    const settings = { ...project(), name: "Renamed project" };
    expect(validateProjectDeletion(settings, "My project", null, true)).not.toBeNull();
    expect(validateProjectDeletion(settings, "Renamed project", null, false)).toBeNull();
  });

  it.each([undefined, null, false, "true", 1])("rejects missing or invalid acknowledgement %s", (acknowledged) => {
    const settings = project([resource({ running: true })]);
    expect(validateProjectDeletion(settings, settings.name, settings.projectId, acknowledged))
      .toBe("Confirm that running services will be stopped.");
  });

  it("allows deletion after acknowledging the selected project's running services", () => {
    const settings = project([resource({ running: true })]);
    expect(validateProjectDeletion(settings, settings.name, settings.projectId, true)).toBeNull();
  });

  it("allows deletion without acknowledgement when the guard does not apply", () => {
    const settings = project([resource({ running: true })]);
    expect(validateProjectDeletion(settings, settings.name, "another-project", false)).toBeNull();
    expect(validateProjectDeletion(project(), "My project", "project-1", false)).toBeNull();
  });
});

describe("project ownership", () => {
  it("returns the owned project without dropping its fields", () => {
    const owned = project();
    expect(requireOwnedProject([owned], owned.projectId)).toBe(owned);
  });

  it("rejects absent projects even when another project has the requested name", () => {
    expect(() => requireOwnedProject([], "project-1")).toThrow("Project not found or access denied.");
    expect(() => requireOwnedProject([project()], "My project")).toThrow("Project not found or access denied.");
    expect(() => requireOwnedProject([project()], "other-project")).toThrow("Project not found or access denied.");
  });
});
