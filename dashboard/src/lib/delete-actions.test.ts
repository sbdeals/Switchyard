import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appLifecycleAction,
  composeLifecycleAction,
  lifecycleAction,
  removeDestinationAction,
  removeEnvironmentAction,
  removeProjectAction,
} from "../app/actions";

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  loadWorkspace: vi.fn(),
  listDestinations: vi.fn(),
  removeProject: vi.fn(),
  removeEnvironment: vi.fn(),
  applicationAction: vi.fn(),
  composeAction: vi.fn(),
  databaseAction: vi.fn(),
  removeDestination: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/dokploy", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  api.listProjects.mockResolvedValue([{
    projectId: "project-owned",
    name: "My project",
    environments: [{ environmentId: "environment-owned", name: "Production" }],
  }]);
  api.loadWorkspace.mockResolvedValue({
    services: [
      { id: "app-owned", kind: "application" },
      { id: "compose-owned", kind: "compose" },
      ...(["postgres", "mysql", "mariadb", "mongo", "redis"] as const).map((engine) => ({
        id: `${engine}-owned`, kind: "database", engine,
      })),
    ],
  });
  api.listDestinations.mockResolvedValue([{ destinationId: "destination-owned" }]);
});

const deleteCases = [
  {
    name: "project", id: "project-owned", remove: removeProjectAction,
    mutation: api.removeProject, lookup: api.listProjects,
    args: ["project-owned"],
  },
  {
    name: "environment", id: "environment-owned", remove: removeEnvironmentAction,
    mutation: api.removeEnvironment, lookup: api.listProjects,
    args: ["environment-owned"],
  },
  {
    name: "application", id: "app-owned", remove: (id: string) => appLifecycleAction(id, "remove"),
    mutation: api.applicationAction, lookup: api.loadWorkspace,
    args: ["app-owned", "remove"],
  },
  {
    name: "compose", id: "compose-owned", remove: (id: string) => composeLifecycleAction(id, "remove"),
    mutation: api.composeAction, lookup: api.loadWorkspace,
    args: ["compose-owned", "remove"],
  },
  ...(["postgres", "mysql", "mariadb", "mongo", "redis"] as const).map((engine) => ({
    name: engine, id: `${engine}-owned`,
    remove: (id: string) => lifecycleAction(engine, id, "remove"),
    mutation: api.databaseAction, lookup: api.loadWorkspace,
    args: [engine, `${engine}-owned`, "remove"],
  })),
  {
    name: "destination", id: "destination-owned", remove: removeDestinationAction,
    mutation: api.removeDestination, lookup: api.listDestinations,
    args: ["destination-owned"],
  },
];

describe.each(deleteCases)("$name deletion ownership", ({ id, remove, mutation, lookup, args }) => {
  it("deletes an owned resource after checking membership", async () => {
    await expect(remove(id)).resolves.toEqual({ ok: true });
    expect(mutation).toHaveBeenCalledExactlyOnceWith(...args);
    expect(lookup.mock.invocationCallOrder[0]).toBeLessThan(mutation.mock.invocationCallOrder[0]);
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("does not delete a resource outside the workspace", async () => {
    await expect(remove("unowned")).resolves.toMatchObject({ ok: false });
    expect(mutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not delete when the membership lookup fails", async () => {
    lookup.mockRejectedValueOnce(new Error("Workspace unavailable."));
    await expect(remove(id)).resolves.toMatchObject({ ok: false });
    expect(mutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("service deletion scope", () => {
  it("rejects a different service kind", async () => {
    await expect(appLifecycleAction("compose-owned", "remove")).resolves.toMatchObject({ ok: false });
    await expect(composeLifecycleAction("app-owned", "remove")).resolves.toMatchObject({ ok: false });
    await expect(lifecycleAction("postgres", "app-owned", "remove")).resolves.toMatchObject({ ok: false });
    expect(api.applicationAction).not.toHaveBeenCalled();
    expect(api.composeAction).not.toHaveBeenCalled();
    expect(api.databaseAction).not.toHaveBeenCalled();
  });

  it("rejects a database ID for another engine", async () => {
    await expect(lifecycleAction("mysql", "postgres-owned", "remove")).resolves.toMatchObject({ ok: false });
    expect(api.databaseAction).not.toHaveBeenCalled();
  });

  it("rechecks the workspace on each delete", async () => {
    await appLifecycleAction("app-owned", "remove");
    api.loadWorkspace.mockResolvedValueOnce({ services: [] });
    await expect(appLifecycleAction("app-owned", "remove")).resolves.toMatchObject({ ok: false });
    expect(api.applicationAction).toHaveBeenCalledTimes(1);
    expect(api.loadWorkspace).toHaveBeenCalledTimes(2);
  });

  it.each(["deploy", "start", "stop"] as const)("preserves %s behavior", async (action) => {
    await expect(appLifecycleAction("app-owned", action)).resolves.toEqual({ ok: true });
    await expect(composeLifecycleAction("compose-owned", action)).resolves.toEqual({ ok: true });
    await expect(lifecycleAction("postgres", "postgres-owned", action)).resolves.toEqual({ ok: true });
    expect(api.loadWorkspace).not.toHaveBeenCalled();
    expect(api.applicationAction).toHaveBeenCalledWith("app-owned", action);
    expect(api.composeAction).toHaveBeenCalledWith("compose-owned", action);
    expect(api.databaseAction).toHaveBeenCalledWith("postgres", "postgres-owned", action);
  });
});
