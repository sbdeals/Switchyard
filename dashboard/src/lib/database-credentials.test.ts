import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseCredentials } from "../components/service/DatabaseCredentials";
import { loadDatabasePasswordAction } from "@/app/actions";
import type { Database } from "./dokploy";
import { databaseCredentialValue } from "./database-credentials";

vi.mock("@/app/actions", () => ({ loadDatabasePasswordAction: vi.fn() }));

const db: Database = {
  kind: "database",
  engine: "postgres",
  id: "database-id",
  name: "test-db",
  appName: "test-db-app",
  status: "idle",
  projectId: "project-id",
  projectName: "Test project",
  environmentId: "environment-id",
  environmentName: "production",
  dockerImage: "postgres:17",
  env: null,
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: null,
  databaseName: "app",
  databaseUser: "user",
  databasePassword: "page-password-sentinel",
  externalPort: null,
  command: null,
};

beforeEach(() => vi.clearAllMocks());

describe("database credentials", () => {
  it.each(["connection", "password"] as const)("keeps %s unavailable until explicitly loaded", (kind) => {
    expect(databaseCredentialValue(db, undefined, kind)).toBeNull();
    const html = renderToStaticMarkup(createElement(DatabaseCredentials, { db, kind }));

    expect(html).not.toContain("page-password-sentinel");
    expect(html).not.toContain("postgresql://");
    expect(html).not.toContain('aria-label="Copy to clipboard"');
    expect(html).toContain(`aria-label="Show ${kind === "connection" ? "connection string" : "password"}"`);
    expect(loadDatabasePasswordAction).not.toHaveBeenCalled();
  });

  it("constructs the connection string with the password loaded by the action", () => {
    expect(databaseCredentialValue(db, "action-password", "connection"))
      .toBe("postgresql://user:action-password@test-db-app:5432/app");
    expect(databaseCredentialValue(db, "action-password", "password")).toBe("action-password");
    expect(db.databasePassword).toBe("page-password-sentinel");
  });

  it("allows a passwordless connection only after the action confirms there is no password", () => {
    expect(databaseCredentialValue(db, undefined, "connection")).toBeNull();
    expect(databaseCredentialValue(db, null, "connection"))
      .toBe("postgresql://user:@test-db-app:5432/app");
    expect(databaseCredentialValue(db, null, "password")).toBeNull();
  });
});
