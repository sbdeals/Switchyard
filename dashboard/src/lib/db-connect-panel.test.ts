import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Engine } from "./dokploy";
import { ConnectTab } from "../components/service/ConnectTab";
import { getDatabaseConnectionAction } from "../app/db-connect-actions";

// primitives' DangerZone imports the server-only lifecycle actions.
vi.mock("@/app/actions", () => ({
  appLifecycleAction: vi.fn(), composeLifecycleAction: vi.fn(), lifecycleAction: vi.fn(),
}));
vi.mock("../app/db-connect-actions", () => ({ getDatabaseConnectionAction: vi.fn() }));

function database(overrides: Partial<Database> = {}): Database {
  return {
    kind: "database", id: "db-id", engine: "postgres", name: "Display name",
    appName: "dokploy-internal-name", databaseUser: "admin", databaseName: "app",
    databasePassword: "must-never-render@:/?#%", externalPort: null,
    status: "idle", projectId: "project", projectName: "Project",
    environmentId: "env", environmentName: "production", dockerImage: null,
    env: null, createdAt: null, cpuLimit: null, memoryLimit: null, replicas: null,
    command: null, ...overrides,
  };
}

const render = (db: Database) => renderToStaticMarkup(createElement(ConnectTab, { db }));

beforeEach(() => vi.clearAllMocks());

describe("database Connect panel", () => {
  it.each<[Engine, string, string]>([
    ["postgres", "5432", "psql"],
    ["mysql", "3306", "mysql"],
    ["mariadb", "3306", "mysql"],
    ["mongo", "27017", "mongosh"],
    ["redis", "6379", "redis-cli"],
  ])("renders masked %s connections without fetching credentials", (engine, port, cli) => {
    const db = database({ engine });
    const html = render(db);
    expect(html).toContain("dokploy-internal-name");
    expect(html).toContain(port);
    expect(html).toContain(cli);
    expect(html).toContain("dokploy-network");
    expect(html).toContain("••••••••");
    expect(html).not.toContain(db.databasePassword);
    expect(html).not.toContain(encodeURIComponent(db.databasePassword!));
    expect(getDatabaseConnectionAction).not.toHaveBeenCalled();
    for (const label of ["password", "internal uri", "cli command"]) {
      expect(html).toContain(`aria-label="Show ${label}"`);
      expect(html).toContain(`aria-label="Copy ${label}"`);
    }
  });

  it("offers exposure instructions without an external URI or port editor", () => {
    const html = render(database());
    expect(html).toContain("This database is internal only");
    expect(html).toContain("External port in Settings");
    expect(html).not.toContain("External URI");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
  });

  it("renders the configured external endpoint without changing the internal endpoint", () => {
    const html = render(database({ externalPort: 15432, externalHost: "db.example.test" }));
    expect(html).toContain("External URI");
    expect(html).toContain("db.example.test:15432");
    expect(html).toContain("dokploy-internal-name:5432");
    expect(html).not.toContain("SERVER_HOST");
    expect(html).not.toContain("must-never-render");
  });

  it("marks an unknown external host as a template", () => {
    const html = render(database({ externalPort: 15432 }));
    expect(html).toContain("SERVER_HOST:15432");
    expect(html).toContain("reachable hostname or IP");
  });

  it("does not invent an internal hostname from the display name", () => {
    const html = render(database({ appName: "" }));
    expect(html).toContain("internal hostname is unavailable");
    expect(html).not.toContain("Show internal uri");
    expect(html).not.toContain("Display name");
  });
});
