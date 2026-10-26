import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteProjectSettings,
  getProjectSettings,
  updateProjectEnvironment,
  updateProjectSettings,
} from "./project-settings-server";
import { projectInventoryKey, projectResources, requiresRunningConfirmation } from "./project-settings";

const { request, listRuntimeStates } = vi.hoisted(() => ({
  request: vi.fn<(path: string, options?: { method: string; body: Record<string, unknown> }) => Promise<unknown>>(),
  listRuntimeStates: vi.fn<() => Promise<{ swarm: Map<string, string[]>; compose: Map<string, string[]> }>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({ request }));
vi.mock("./docker", () => ({ listRuntimeStates }));

const collections = ["applications", "compose", "postgres", "mysql", "mariadb", "mongo", "redis", "libsql"] as const;
type Collection = (typeof collections)[number];
type RawResource = Record<string, string>;
type RawEnvironment = {
  environmentId: string;
  name: string;
  isDefault: boolean;
} & Partial<Record<Collection, RawResource[]>>;
type RawProject = {
  projectId: string;
  name: string;
  description: string | null;
  environments: RawEnvironment[];
};

function service(kind = "application", overrides: RawResource = {}): RawResource {
  return {
    [`${kind}Id`]: `${kind}-1`, name: `${kind} service`, appName: `${kind}-runtime`,
    applicationStatus: "done", composeStatus: "error", ...overrides,
  };
}

function project(resources: Partial<Record<Collection, RawResource[]>> = {}): RawProject {
  return {
    projectId: "project-1", name: "Settings proof", description: "Project description",
    environments: [{ environmentId: "env-1", name: "production", isDefault: true, ...resources }],
  };
}

function inventoryKey(data: RawProject): string {
  return projectInventoryKey({
    ...data, description: data.description ?? "", canDelete: true,
    environments: data.environments.map((environment) => ({
      environmentId: environment.environmentId, name: environment.name, isDefault: environment.isDefault,
      services: collections.flatMap((collection) => {
        const kind = collection === "applications" ? "application" : collection;
        return (environment[collection] ?? []).map((resource) => ({
          id: resource[`${kind}Id`], name: resource.name ?? resource[`${kind}Id`], kind, appName: "", status: "",
        }));
      }),
    })),
  });
}

let reviewedInventory: string;

function mockApi({
  inventories = [project()], ownership, role = "owner", failAt,
}: {
  inventories?: RawProject[];
  ownership?: RawProject[][];
  role?: string;
  failAt?: string;
} = {}) {
  reviewedInventory = inventoryKey(inventories[0]);
  let inventoryRead = 0;
  let ownershipRead = 0;
  request.mockImplementation(async (path) => {
    if (path === failAt) throw new Error("Dokploy cleanup failed");
    if (path === "project.all") {
      const snapshots = ownership ?? [[inventories[0]]];
      return snapshots[Math.min(ownershipRead++, snapshots.length - 1)];
    }
    if (path.startsWith("project.one?projectId=")) {
      return inventories[Math.min(inventoryRead++, inventories.length - 1)];
    }
    if (path === "user.get") return { role };
    return {};
  });
}

function mutations() {
  return request.mock.calls.filter(([, options]) => options?.method === "POST");
}

beforeEach(() => {
  vi.resetAllMocks();
  listRuntimeStates.mockResolvedValue({ swarm: new Map(), compose: new Map() });
});

describe("project settings metadata", () => {
  it("projects all eight resource types across environments without exposing extra fields", async () => {
    const data = project();
    const preview: RawEnvironment = { environmentId: "env-2", name: "preview", isDefault: false };
    const resources = collections.map((collection) => {
      const kind = collection === "applications" ? "application" : collection;
      const raw = service(kind, {
        env: "SYNTHETIC_ENV=not-real", databasePassword: "synthetic-test-placeholder",
        accessToken: "synthetic-access-placeholder",
      });
      const environment = collection === "libsql" ? preview : data.environments[0];
      environment[collection] = [raw];
      return {
        id: `${kind}-1`, name: `${kind} service`, kind, appName: `${kind}-runtime`,
        status: kind === "compose" ? "error" : "done",
      };
    });
    data.environments.push(preview);
    mockApi({ inventories: [data] });

    const settings = await getProjectSettings(data.projectId);

    expect(settings).toEqual({
      projectId: data.projectId, name: data.name, description: data.description, canDelete: true,
      environments: [
        { environmentId: "env-1", name: "production", isDefault: true, services: resources.slice(0, 7) },
        { environmentId: "env-2", name: "preview", isDefault: false, services: resources.slice(7) },
      ],
    });
    expect(projectResources(settings)).toHaveLength(8);
    expect(JSON.stringify(settings)).not.toContain("synthetic");
    expect(JSON.stringify(settings)).not.toContain("SYNTHETIC_ENV");
  });

  it("defaults absent descriptions and resource display fields", async () => {
    const data = project({ applications: [{ applicationId: "app-without-metadata" }] });
    data.description = null;
    mockApi({ inventories: [data] });

    const settings = await getProjectSettings(data.projectId);

    expect(settings.description).toBe("");
    expect(settings.environments[0].services).toEqual([{
      id: "app-without-metadata", name: "app-without-metadata", kind: "application",
      appName: "", status: "idle",
    }]);
  });

  it.each(["owner", "admin", "member", "unknown"])("allows deletion only for owners and admins: %s", async (role) => {
    mockApi({ role });
    expect((await getProjectSettings("project-1")).canDelete).toBe(role === "owner" || role === "admin");
  });

  it("uses compose and swarm runtime state instead of deployment status", async () => {
    const data = project({
      applications: [service("application", { applicationStatus: "error" })],
      compose: [service("compose", { composeStatus: "done" })],
      postgres: [service("postgres")],
    });
    mockApi({ inventories: [data] });
    listRuntimeStates.mockResolvedValue({
      swarm: new Map([["application-runtime", ["running"]], ["compose-runtime", ["running"]]]),
      compose: new Map([["compose-runtime", ["exited"]]]),
    });

    const settings = await getProjectSettings(data.projectId);

    expect(settings.environments[0].services.map(({ kind, running }) => ({ kind, running }))).toEqual([
      { kind: "application", running: true }, { kind: "compose", running: false }, { kind: "postgres", running: undefined },
    ]);
    expect(requiresRunningConfirmation(settings, data.projectId)).toBe(true);
  });

  it("keeps runtime unavailable so deploy status supplies the confirmation fallback", async () => {
    mockApi({ inventories: [project({ applications: [service()] })] });
    listRuntimeStates.mockRejectedValue(new Error("Socket unavailable"));

    const settings = await getProjectSettings("project-1");

    expect(settings.environments[0].services[0]).not.toHaveProperty("running");
    expect(requiresRunningConfirmation(settings, settings.projectId)).toBe(true);
  });

  it("retains the deploy-status fallback for remote services missing from local Docker", async () => {
    mockApi({ inventories: [project({ applications: [service("application", { serverId: "remote-server" })] })] });

    const settings = await getProjectSettings("project-1");

    expect(settings.environments[0].services[0]).not.toHaveProperty("running");
    expect(settings.environments[0].services[0]).not.toHaveProperty("serverId");
    expect(requiresRunningConfirmation(settings, settings.projectId)).toBe(true);
  });

  it("retains deploy-status fallback when local Docker has no entry for a stack or remote replica", async () => {
    mockApi({ inventories: [project({
      compose: [service("compose", { composeType: "stack", composeStatus: "done" })],
      applications: [service("application")],
    })] });

    const settings = await getProjectSettings("project-1");

    for (const resource of settings.environments[0].services) expect(resource).not.toHaveProperty("running");
    expect(requiresRunningConfirmation(settings, settings.projectId)).toBe(true);
  });

  it("checks fresh ownership before fetching project details", async () => {
    mockApi({ ownership: [[project()], []] });
    await getProjectSettings("project-1");
    await expect(getProjectSettings("project-1")).rejects.toThrow("Project not found or access denied.");
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "project.all", "project.one?projectId=project-1", "user.get", "project.all",
    ]);
    expect(listRuntimeStates).toHaveBeenCalledTimes(1);
  });

  it("encodes project IDs in the details query", async () => {
    const data = { ...project(), projectId: "project/with&query" };
    mockApi({ inventories: [data] });
    await getProjectSettings(data.projectId);
    expect(request).toHaveBeenCalledWith("project.one?projectId=project%2Fwith%26query");
  });
});

describe("project and environment updates", () => {
  it("trims the project name and sends an empty description to clear it", async () => {
    mockApi();
    await updateProjectSettings("project-1", " Renamed project ", "");
    expect(request.mock.calls).toEqual([
      ["project.all"],
      ["project.update", { method: "POST", body: { projectId: "project-1", name: "Renamed project", description: "" } }],
    ]);
  });

  it("checks ownership again for each update", async () => {
    mockApi({ ownership: [[project()], []] });
    await updateProjectSettings("project-1", "Allowed", "First update");
    await expect(updateProjectSettings("project-1", "Forbidden", "Second update"))
      .rejects.toThrow("Project not found or access denied.");
    expect(mutations()).toHaveLength(1);
    expect(request.mock.calls.at(-1)).toEqual(["project.all"]);
  });

  it("rejects blank names before calling Dokploy", async () => {
    mockApi();
    await expect(updateProjectSettings("project-1", " \n", "Description")).rejects.toThrow("Enter a project name.");
    expect(request).not.toHaveBeenCalled();
  });

  it("renames an owned preview environment with the verified endpoint and fields", async () => {
    const data = project();
    data.environments.push({ environmentId: "env-2", name: "preview", isDefault: false });
    mockApi({ inventories: [data] });
    await updateProjectEnvironment("env-2", " staging ");
    expect(request.mock.calls).toEqual([
      ["project.all"],
      ["environment.update", { method: "POST", body: { environmentId: "env-2", name: "staging" } }],
    ]);
  });

  it.each([
    { name: "main", isDefault: true },
    { name: " PrOdUcTiOn ", isDefault: false },
  ])("protects default and production environments: %s", async (environment) => {
    const data = project();
    Object.assign(data.environments[0], environment);
    mockApi({ inventories: [data] });
    await expect(updateProjectEnvironment("env-1", "staging")).rejects.toThrow("cannot be renamed");
    expect(mutations()).toEqual([]);
  });

  it("rejects an environment absent from the caller's fresh project list", async () => {
    mockApi({ ownership: [[]] });
    await expect(updateProjectEnvironment("env-1", "staging")).rejects.toThrow("Environment not found or access denied.");
    expect(request.mock.calls).toEqual([["project.all"]]);
  });

  it("rejects a blank preview environment name without mutating", async () => {
    const data = project();
    Object.assign(data.environments[0], { name: "preview", isDefault: false });
    mockApi({ inventories: [data] });
    await expect(updateProjectEnvironment("env-1", " \n")).rejects.toThrow("Enter an environment name.");
    expect(mutations()).toEqual([]);
  });
});

describe("project deletion", () => {
  it("rejects a missing owned project before reading or mutating resources", async () => {
    mockApi({ ownership: [[]] });
    await expect(deleteProjectSettings("project-1", "Settings proof", "project-1", true, reviewedInventory))
      .rejects.toThrow("Project not found or access denied.");
    expect(request.mock.calls).toEqual([["project.all"]]);
  });

  it.each(["settings proof", "Settings proof ", "Old project name"])("rejects an inexact or stale confirmation: %s", async (name) => {
    mockApi({ inventories: [project({ applications: [service()] })] });
    await expect(deleteProjectSettings("project-1", name, "project-1", true, reviewedInventory)).rejects.toThrow("exact project name");
    expect(mutations()).toEqual([]);
  });

  it("rejects members before cleanup even if they can see the project", async () => {
    mockApi({ inventories: [project({ applications: [service()] })], role: "member" });
    await expect(deleteProjectSettings("project-1", "Settings proof", "project-1", true, reviewedInventory))
      .rejects.toThrow("Only organization owners and admins");
    expect(mutations()).toEqual([]);
  });

  it("rejects an unacknowledged selected project with a running service", async () => {
    mockApi({ inventories: [project({ compose: [service("compose")] })] });
    listRuntimeStates.mockResolvedValue({ swarm: new Map(), compose: new Map([["compose-runtime", ["running"]]]) });
    await expect(deleteProjectSettings("project-1", "Settings proof", "project-1", false, reviewedInventory))
      .rejects.toThrow("Confirm that running services will be stopped.");
    expect(mutations()).toEqual([]);
  });

  it("requires acknowledgement using deploy status when runtime lookup fails", async () => {
    mockApi({ inventories: [project({ postgres: [service("postgres")] })] });
    listRuntimeStates.mockRejectedValue(new Error("Socket unavailable"));
    await expect(deleteProjectSettings("project-1", "Settings proof", "project-1", false, reviewedInventory))
      .rejects.toThrow("Confirm that running services will be stopped.");
    expect(mutations()).toEqual([]);
  });

  it.each([
    ["new resource", (data: RawProject) => { data.environments[0].redis = [service("redis")]; }],
    ["renamed resource", (data: RawProject) => { data.environments[0].applications![0].name = "Renamed website"; }],
    ["new empty environment", (data: RawProject) => data.environments.push({
      environmentId: "new-environment", name: "preview", isDefault: false,
    })],
  ] as const)("rejects a %s added since the danger list was reviewed before any cleanup", async (_label, change) => {
    const reviewed = project({ applications: [service()] });
    const current = structuredClone(reviewed);
    change(current);
    mockApi({ inventories: [current, project()] });

    await expect(deleteProjectSettings("project-1", "Settings proof", "project-1", true, inventoryKey(reviewed)))
      .rejects.toThrow("Project services changed. Review the list and confirm deletion again.");

    expect(mutations()).toEqual([]);
    expect(request.mock.calls.filter(([path]) => path === "project.all")).toHaveLength(1);
  });

  it("accepts a reviewed inventory whose service and environment order changed", async () => {
    const reviewed = project({ applications: [service(), service("application", { applicationId: "app-2", name: "Worker" })] });
    reviewed.environments.push({ environmentId: "env-2", name: "preview", isDefault: false });
    const reordered = structuredClone(reviewed);
    reordered.environments[0].applications!.reverse();
    reordered.environments.reverse();
    mockApi({ inventories: [reordered, project()] });

    await deleteProjectSettings("project-1", "Settings proof", "project-1", true, inventoryKey(reviewed));

    expect(mutations().map(([path]) => path)).toEqual(["application.delete", "application.delete", "project.remove"]);
  });

  it("cleans all eight resource kinds through Dokploy before a second fresh empty inventory permits project.remove", async () => {
    const data = project();
    for (const collection of collections) {
      data.environments[0][collection] = [service(collection === "applications" ? "application" : collection)];
    }
    mockApi({ inventories: [data, project()] });
    listRuntimeStates.mockResolvedValue({ swarm: new Map([["application-runtime", ["running"]]]), compose: new Map() });

    await deleteProjectSettings("project-1", data.name, data.projectId, true, reviewedInventory);

    expect(mutations()).toEqual([
      ["application.delete", { method: "POST", body: { applicationId: "application-1" } }],
      ["compose.delete", { method: "POST", body: { composeId: "compose-1", deleteVolumes: false } }],
      ["postgres.remove", { method: "POST", body: { postgresId: "postgres-1" } }],
      ["mysql.remove", { method: "POST", body: { mysqlId: "mysql-1" } }],
      ["mariadb.remove", { method: "POST", body: { mariadbId: "mariadb-1" } }],
      ["mongo.remove", { method: "POST", body: { mongoId: "mongo-1" } }],
      ["redis.remove", { method: "POST", body: { redisId: "redis-1" } }],
      ["libsql.remove", { method: "POST", body: { libsqlId: "libsql-1" } }],
      ["project.remove", { method: "POST", body: { projectId: "project-1" } }],
    ]);
    expect(request.mock.calls.slice(-4)).toEqual([
      ["project.all"], ["project.one?projectId=project-1"], ["user.get"],
      ["project.remove", { method: "POST", body: { projectId: "project-1" } }],
    ]);
    expect(request.mock.calls.filter(([path]) => path === "project.all")).toHaveLength(2);
    expect(listRuntimeStates).toHaveBeenCalledTimes(2);
  });

  it("permits deletion of an unselected running project without acknowledgement", async () => {
    mockApi({ inventories: [project({ applications: [service()] }), project()] });
    listRuntimeStates.mockResolvedValue({ swarm: new Map([["application-runtime", ["running"]]]), compose: new Map() });
    await deleteProjectSettings("project-1", "Settings proof", "other-project", false, reviewedInventory);
    expect(mutations().map(([path]) => path)).toEqual(["application.delete", "project.remove"]);
  });

  it("requires an empty second inventory even when the first inventory was empty", async () => {
    mockApi({ inventories: [project()] });
    await deleteProjectSettings("project-1", "Settings proof", "project-1", false, reviewedInventory);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "project.all", "project.one?projectId=project-1", "user.get",
      "project.all", "project.one?projectId=project-1", "user.get", "project.remove",
    ]);
  });

  it("preserves the project and newly appeared resources when the inventory changes during cleanup", async () => {
    mockApi({ inventories: [
      project({ applications: [service()] }),
      project({ redis: [service("redis", { redisId: "new-redis" })] }),
    ] });
    await expect(deleteProjectSettings("project-1", "Settings proof", "project-1", true, reviewedInventory))
      .rejects.toThrow("Project services changed during deletion.");
    expect(mutations().map(([path]) => path)).toEqual(["application.delete"]);
  });

  it("rejects stale name confirmation when the project is renamed during cleanup", async () => {
    mockApi({ inventories: [
      project({ compose: [service("compose")] }), { ...project(), name: "Renamed concurrently" },
    ] });
    await expect(deleteProjectSettings("project-1", "Settings proof", "project-1", true, reviewedInventory))
      .rejects.toThrow("Type the exact project name to confirm deletion.");
    expect(mutations().map(([path]) => path)).toEqual(["compose.delete"]);
  });

  it("stops before project.remove when ownership disappears during cleanup", async () => {
    const data = project({ applications: [service()] });
    mockApi({ inventories: [data, project()], ownership: [[data], []] });
    await expect(deleteProjectSettings("project-1", "Settings proof", "project-1", true, reviewedInventory))
      .rejects.toThrow("Project not found or access denied.");
    expect(mutations().map(([path]) => path)).toEqual(["application.delete"]);
    expect(request.mock.calls.at(-1)).toEqual(["project.all"]);
  });

  it("stops the cascade on cleanup failure without deleting the project", async () => {
    mockApi({
      inventories: [project({ applications: [service()], postgres: [service("postgres")] }), project()],
      failAt: "application.delete",
    });
    await expect(deleteProjectSettings("project-1", "Settings proof", "project-1", true, reviewedInventory))
      .rejects.toThrow("Dokploy cleanup failed");
    expect(mutations().map(([path]) => path)).toEqual(["application.delete"]);
    expect(request.mock.calls.filter(([path]) => path === "project.all")).toHaveLength(1);
  });
});
