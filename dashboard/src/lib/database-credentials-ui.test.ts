import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadDatabasePasswordAction } from "../app/actions";
import { DatabaseCredentials } from "../components/service/DatabaseCredentials";
import type { Database } from "./dokploy";

vi.mock("@/app/actions", () => ({ loadDatabasePasswordAction: vi.fn() }));

const database: Database = {
  kind: "database",
  engine: "postgres",
  id: "database-id",
  name: "test-database",
  appName: "test-database-app",
  status: "idle",
  projectId: "project-id",
  projectName: "Test project",
  environmentId: "environment-id",
  environmentName: "production",
  dockerImage: "postgres:18",
  env: "TOKEN=env-prop-sentinel",
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: null,
  databaseName: "test",
  databaseUser: "test",
  databasePassword: "database-password-prop-sentinel",
  externalPort: null,
  command: null,
};

describe("database credential display", () => {
  it.each([false, true])("waits for the action before rendering credentials (passwordOnly=%s)", (passwordOnly) => {
    const html = renderToStaticMarkup(createElement(DatabaseCredentials, { db: database, passwordOnly }));

    expect(html).toContain('role="status"');
    expect(html).toContain("Loading database credentials");
    expect(html).toContain(passwordOnly ? "Password" : "Connection string");
    expect(html).not.toContain("database-password-prop-sentinel");
    expect(html).not.toContain("env-prop-sentinel");
    expect(html).not.toContain("Copy to clipboard");
    expect(html).not.toContain("postgresql://");
    expect(loadDatabasePasswordAction).not.toHaveBeenCalled();
  });
});
