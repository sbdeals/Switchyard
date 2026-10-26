import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateServiceReferencesAction } from "../app/reference-actions";
import { ENGINES, type Database, type MountServiceType } from "./dokploy";
import type { VariableRow } from "./variable-rows";

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  redirect: new Error("NEXT_REDIRECT"),
}));

vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({
  ENGINES: ["postgres", "mysql", "mariadb", "mongo", "redis"],
  loadWorkspace: mocks.loadWorkspace,
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error === mocks.redirect) throw error;
  },
}));

const database: Database = {
  kind: "database",
  id: "owned-id",
  name: "db",
  appName: "db-internal",
  status: "idle",
  projectId: "project-id",
  projectName: "Project",
  environmentId: "environment-id",
  environmentName: "production",
  dockerImage: "postgres:17",
  env: "TOKEN=stored-env-secret",
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: null,
  engine: "postgres",
  databaseName: "app",
  databaseUser: "app",
  databasePassword: "database-secret",
  externalPort: null,
  command: null,
};
const genericFailure = { ok: false, error: "Could not validate variable references." };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadWorkspace.mockResolvedValue({ services: [database], projects: [] });
});

describe("validateServiceReferencesAction", () => {
  it("returns reference status without resolved values or stored env", async () => {
    const result = await validateServiceReferencesAction(
      "postgres", database.id,
      "URL=${{db.DATABASE_URL}}\nTOKEN=typed-env-secret"
    );

    expect(result).toEqual({ ok: true, referencing: ["URL"], issues: [], rowIssues: [] });
    expect(JSON.stringify(result)).not.toMatch(/stored-env-secret|database-secret|typed-env-secret/);
  });

  it.each(ENGINES)("accepts an owned %s service", async (engine) => {
    mocks.loadWorkspace.mockResolvedValue({ services: [{ ...database, engine }], projects: [] });

    expect(await validateServiceReferencesAction(engine, database.id, "KEY=value")).toEqual({
      ok: true, referencing: [], issues: [], rowIssues: [],
    });
  });

  it.each(["application", "compose"] as const)("accepts an owned %s service", async (kind) => {
    mocks.loadWorkspace.mockResolvedValue({ services: [{ ...database, kind }], projects: [] });

    expect(await validateServiceReferencesAction(kind, database.id, "KEY=value")).toEqual({
      ok: true, referencing: [], issues: [], rowIssues: [],
    });
  });

  it("rejects another account's id", async () => {
    expect(await validateServiceReferencesAction("postgres", "unowned-id", "X=${{db.TOKEN}}")).toEqual(genericFailure);
  });

  it("rejects an id owned under another kind or engine", async () => {
    expect(await validateServiceReferencesAction("application", database.id, "KEY=value")).toEqual(genericFailure);
    expect(await validateServiceReferencesAction("mysql", database.id, "KEY=value")).toEqual(genericFailure);
  });

  it("rejects invalid runtime arguments before loading any workspace", async () => {
    expect(await validateServiceReferencesAction("destination" as MountServiceType, database.id, "KEY=value")).toEqual(genericFailure);
    expect(await validateServiceReferencesAction("postgres", "", "KEY=value")).toEqual(genericFailure);
    expect(await validateServiceReferencesAction("postgres", database.id, null as unknown as string)).toEqual(genericFailure);
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
  });

  it.each([null, {}, [null], [{ index: -1, key: "A", value: "x" }], [{ index: 0, key: "A", value: 3 }]])("rejects invalid row drafts %j before loading any workspace", async (rows) => {
    expect(await validateServiceReferencesAction("postgres", database.id, "A=x", rows as unknown as VariableRow[])).toEqual(genericFailure);
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
  });

  it("keeps missing service and variable errors for live validation", async () => {
    const result = await validateServiceReferencesAction(
      "postgres", database.id, "MISSING=${{nope.TOKEN}}\nVALUE=${{db.UNKNOWN}}"
    );

    expect(result).toMatchObject({
      ok: true,
      referencing: ["MISSING", "VALUE"],
      issues: [
        { key: "MISSING", message: 'No service named "nope".' },
        { key: "VALUE", message: expect.stringContaining('"db" has no variable UNKNOWN') },
      ],
    });
  });

  it("checks stored reference chains using the current draft for self", async () => {
    const upstream = {
      ...database, id: "upstream-id", name: "upstream",
      env: "# switchyard:ref CHAIN=${{db.VALUE}}\nCHAIN=previous-secret",
    };
    mocks.loadWorkspace.mockResolvedValue({ services: [database, upstream], projects: [] });

    const valid = await validateServiceReferencesAction("postgres", database.id, "VALUE=new-secret\nUSE=${{upstream.CHAIN}}");
    expect(valid).toEqual({ ok: true, referencing: ["USE"], issues: [], rowIssues: [] });

    const cycle = await validateServiceReferencesAction("postgres", database.id, "VALUE=${{upstream.CHAIN}}");
    expect(cycle).toMatchObject({
      ok: true,
      issues: [{ key: "VALUE", message: "Reference cycle: db.VALUE → upstream.CHAIN → db.VALUE." }],
    });
    expect(JSON.stringify([valid, cycle])).not.toMatch(/previous-secret|new-secret|stored-env-secret|database-secret/);
  });

  it("prefers reference targets in the edited service's environment", async () => {
    const remote = { ...database, id: "remote-id", name: "upstream", environmentId: "remote-env", env: "OTHER=remote-secret" };
    const local = { ...remote, id: "local-id", environmentId: database.environmentId, env: "TOKEN=local-secret" };
    mocks.loadWorkspace.mockResolvedValue({ services: [remote, database, local], projects: [] });

    expect(await validateServiceReferencesAction("postgres", database.id, "VALUE=${{upstream.TOKEN}}")).toEqual({
      ok: true, referencing: ["VALUE"], issues: [], rowIssues: [],
    });
  });

  it.each([
    { projectId: "other-project" },
    { environmentId: "other-environment" },
  ])("does not reveal reference names outside the edited project and environment: %j", async (scope) => {
    const remote = { ...database, ...scope, id: "remote-id", name: "remote", env: "REMOTE_ONLY=remote-secret" };
    mocks.loadWorkspace.mockResolvedValue({ services: [remote, database], projects: [] });

    const result = await validateServiceReferencesAction("postgres", database.id, "VALUE=${{remote.UNKNOWN}}");
    expect(result).toMatchObject({
      ok: true,
      issues: [{ key: "VALUE", message: 'No service named "remote".' }],
      rowIssues: [{ index: 0, key: "VALUE", message: 'No service named "remote".' }],
    });
    expect(JSON.stringify(result)).not.toMatch(/REMOTE_ONLY|remote-secret/);
  });

  it("validates physical duplicate and multiline rows without returning source values", async () => {
    const result = await validateServiceReferencesAction("postgres", database.id,
      '# comment\nURL=${{missing.TOKEN}}\nURL=${{db.DATABASE_URL}}\nMULTI="first\n${{db.MISSING}}\nlast"');

    expect(result).toMatchObject({
      ok: true,
      rowIssues: [
        { index: 1, key: "URL", message: 'No service named "missing".' },
        { index: 3, key: "MULTI", message: expect.stringContaining('"db" has no variable MISSING') },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/stored-env-secret|database-secret/);
  });

  it("keeps table draft indices and validates temporary keys and self cycles", async () => {
    const result = await validateServiceReferencesAction("postgres", database.id, "", [
      { index: 3, key: "#", value: "${{missing.VALUE}}" },
      { index: 7, key: "A", value: "${{db.B}}" },
      { index: 9, key: "B", value: "${{db.A}}" },
    ]);

    expect(result).toMatchObject({
      ok: true,
      rowIssues: [
        { index: 3, key: "#", message: 'No service named "missing".' },
        { index: 7, key: "A", message: "Reference cycle: db.A → db.B → db.A." },
        { index: 9, key: "B", message: "Reference cycle: db.B → db.A → db.B." },
      ],
    });
  });

  it("does not expose backend error details", async () => {
    mocks.loadWorkspace.mockRejectedValue(new Error("private backend detail"));

    expect(await validateServiceReferencesAction("postgres", database.id, "KEY=value")).toEqual(genericFailure);
  });

  it("preserves a login redirect for an invalid session", async () => {
    mocks.loadWorkspace.mockRejectedValue(mocks.redirect);

    await expect(validateServiceReferencesAction("postgres", database.id, "KEY=value")).rejects.toBe(mocks.redirect);
  });
});
