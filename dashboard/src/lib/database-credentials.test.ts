import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DatabaseCredentials } from "../components/service/DatabaseCredentials";
import type { Database } from "./dokploy";

vi.mock("@/app/actions", () => ({ loadDatabasePasswordAction: vi.fn() }));
vi.mock("@/app/staged-actions", () => ({}));

describe("database credential reveal", () => {
  it.each([true, false])("keeps credentials out of the initial UI (connection=%s)", (connection) => {
    const db = {
      id: "db-id", engine: "postgres", databasePassword: "db-prop-sentinel",
      appName: "db-app", databaseName: "app", databaseUser: "user",
    } as Database;
    const html = renderToStaticMarkup(createElement(DatabaseCredentials, { db, connection }));
    expect(html).not.toContain("db-prop-sentinel");
    expect(html).not.toContain("postgresql://");
    expect(html).toContain(connection ? "Show connection string" : "Show password");
    expect(html).not.toContain('aria-label="Copy"');
  });
});
