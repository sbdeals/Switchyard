import { describe, expect, it, vi } from "vitest";
import type { ComposeService, Database } from "./dokploy";
import { referenceableKeys } from "./reference-keys";
import { computeReferenceKeys } from "./reference-vars";

vi.mock("server-only", () => ({}));

const database: Database = {
  kind: "database",
  id: "database-id",
  name: "db",
  appName: "db-internal",
  status: "idle",
  projectId: "project-id",
  projectName: "Project",
  environmentId: "environment-id",
  environmentName: "production",
  dockerImage: "postgres:17",
  env: "TOKEN=env-secret\n# switchyard:ref URL=${{cache.REDIS_URL}}\nURL=redis://resolved-secret",
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

describe("reference key metadata", () => {
  it("keeps decoded own keys and database built-in names without their values", () => {
    const keys = computeReferenceKeys(database);

    expect(keys.own).toEqual(["TOKEN", "URL"]);
    expect(keys.builtin).toEqual(expect.arrayContaining(["DATABASE_URL", "POSTGRES_PASSWORD", "PGPASSWORD"]));
    expect(JSON.stringify(keys)).not.toMatch(/env-secret|resolved-secret|database-secret|\$\{\{/);
  });

  it("preserves managed database reference names before its env is redacted", () => {
    const compose: ComposeService = {
      ...database,
      kind: "compose",
      env: "POSTGRES_USER=app\nPOSTGRES_PASSWORD=managed-secret\nPOSTGRES_DB=app",
      composeFile: null,
      composeType: "docker-compose",
      domains: [],
      deployments: [],
      managed: { kind: "database", engine: "postgres", image: "postgres:17" },
    };
    const keys = computeReferenceKeys(compose);

    expect(keys.own).toContain("POSTGRES_PASSWORD");
    expect(keys.builtin).toContain("DATABASE_URL");
    expect(keys.builtin).toContain("PGPASSWORD");
    expect(keys.builtin).not.toContain("POSTGRES_PASSWORD");
    expect(JSON.stringify(keys)).not.toContain("managed-secret");
  });

  it("uses server-computed names after env and passwords have been redacted", () => {
    const referenceKeys = computeReferenceKeys(database);
    const redacted = { ...database, env: null, databasePassword: null, referenceKeys };

    expect(referenceableKeys(redacted)).toEqual(referenceKeys);
    expect(referenceableKeys(redacted).builtin).toContain("PGPASSWORD");
  });

  it("never reads env or credentials in the client picker, even without metadata", () => {
    expect(referenceableKeys(database)).toEqual({ own: [], builtin: [] });
  });

  it("gives own variables precedence over identically named built-ins", () => {
    const keys = computeReferenceKeys({ ...database, env: "DATABASE_URL=override-secret" });

    expect(keys.own).toEqual(["DATABASE_URL"]);
    expect(keys.builtin).not.toContain("DATABASE_URL");
  });
});
