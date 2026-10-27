import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { Database, Engine } from "./dokploy";
import { buildDatabaseConnection, databaseConnectionDetails } from "./db-connect";
import { connectionString } from "./connection";

const database = (engine: Engine) => ({
  engine,
  appName: "db-connect-internal",
  databaseUser: "app_user",
  databaseName: "app_db",
});

// Replace clients with shell functions to verify argument boundaries without
// requiring any database clients, network access, or real credentials.
function cliArgs(cli: string): string[] {
  const command = cli.split(" ")[0];
  const output = execFileSync("sh", [
    "-c",
    `capture() { printf '%s\\0' "$@"; }\ncapture${cli.slice(command.length)}`,
  ], { encoding: "utf8" });
  return output.split("\0").slice(0, -1);
}

describe("buildDatabaseConnection", () => {
  it.each([
    ["postgres", "postgresql", 5432, "app_user", "app_db", ""],
    ["mysql", "mysql", 3306, "app_user", "app_db", ""],
    ["mariadb", "mysql", 3306, "app_user", "app_db", ""],
    ["mongo", "mongodb", 27017, "app_user", "app_db", "?authSource=admin"],
    ["redis", "redis", 6379, "default", "0", ""],
  ] as const)("builds the %s internal URI", (engine, scheme, port, user, name, query) => {
    const db = { ...database(engine), externalPort: 15432 };
    const result = buildDatabaseConnection(db, "test_password");
    expect(result.uri).toBe(
      `${scheme}://${user}:test_password@db-connect-internal:${port}/${name}${query}`,
    );
    expect(databaseConnectionDetails(db)).toEqual({
      host: "db-connect-internal", port, user, database: name,
    });
  });

  it.each(["postgres", "mysql", "mariadb", "mongo", "redis"] as const)(
    "encodes special characters as individual %s URI components",
    (engine) => {
      const value = "u@:/?#% !'()*$`\\\n日本";
      const db = { ...database(engine), databaseUser: value, databaseName: value };
      const { uri } = buildDatabaseConnection(db, value);
      const parsed = new URL(uri);
      expect(decodeURIComponent(parsed.password)).toBe(value);
      expect(decodeURIComponent(parsed.username)).toBe(engine === "redis" ? "default" : value);
      expect(decodeURIComponent(parsed.pathname.slice(1))).toBe(engine === "redis" ? "0" : value);
      expect(parsed.hash).toBe("");
      expect(parsed.search).toBe(engine === "mongo" ? "?authSource=admin" : "");
      expect(uri).toContain("%40%3A%2F%3F%23%25");
      expect(uri).toContain("%21%27%28%29%2A");
    },
  );

  it.each(["postgres", "mongo", "redis"] as const)(
    "passes the exact %s URI to its CLI",
    (engine) => {
      const { uri, cli } = buildDatabaseConnection(database(engine), "x'@:/?#% $(printf injected)");
      const commands = { postgres: "psql", mongo: "mongosh", redis: "redis-cli" };
      expect(cli.startsWith(`${commands[engine]} `)).toBe(true);
      expect(cliArgs(cli)).toEqual(engine === "redis" ? ["-u", uri] : [uri]);
    },
  );

  it.each(["mysql", "mariadb"] as const)("shell-quotes %s CLI flags without changing values", (engine) => {
    const value = "-x' @:/?#% $(printf injected) `printf injected`\n";
    const { cli } = buildDatabaseConnection({
      ...database(engine), databaseUser: value, databaseName: value,
    }, value);
    expect(cliArgs(cli)).toEqual([
      "--protocol=TCP", "--host=db-connect-internal", "--port=3306",
      `--user=${value}`, `--password=${value}`, `--database=${value}`,
    ]);
  });

  it("uses Mongo's admin database and authentication source when no database is stored", () => {
    const db = { ...database("mongo"), databaseName: null };
    expect(databaseConnectionDetails(db).database).toBe("admin");
    expect(buildDatabaseConnection(db, "password").uri).toBe(
      "mongodb://app_user:password@db-connect-internal:27017/admin?authSource=admin",
    );
  });

  it("uses Redis's default user and database without inventing authentication for an empty password", () => {
    const db = { ...database("redis"), databaseUser: null, databaseName: null };
    expect(databaseConnectionDetails(db)).toMatchObject({ user: "default", database: "0" });
    expect(buildDatabaseConnection(db, "").uri).toBe("redis://db-connect-internal:6379/0");
  });

  it("keeps an explicitly empty SQL password and omits absent optional fields", () => {
    expect(buildDatabaseConnection(database("postgres"), "").uri).toBe(
      "postgresql://app_user:@db-connect-internal:5432/app_db",
    );
    const db = { ...database("mysql"), databaseUser: null, databaseName: null };
    const { uri, cli } = buildDatabaseConnection(db, "");
    expect(uri).toBe("mysql://db-connect-internal:3306/");
    expect(cliArgs(cli)).toEqual([
      "--protocol=TCP", "--host=db-connect-internal", "--port=3306", "--password=",
    ]);
  });

  it("uses an explicitly supplied external endpoint without changing credentials", () => {
    const { uri, cli } = buildDatabaseConnection(database("postgres"), "p@ss", {
      host: "db.example.test", port: 15432,
    });
    expect(uri).toBe("postgresql://app_user:p%40ss@db.example.test:15432/app_db");
    expect(cliArgs(cli)).toEqual([uri]);
  });

  it.each(["2001:db8::1", "[2001:db8::1]"])("supports IPv6 endpoint %s", (host) => {
    const { uri, cli } = buildDatabaseConnection(database("mysql"), "password", { host, port: 13306 });
    expect(uri).toBe("mysql://app_user:password@[2001:db8::1]:13306/app_db");
    expect(cliArgs(cli)).toContain("--host=2001:db8::1");
  });

  it("rejects a missing appName rather than guessing a display name", () => {
    expect(() => buildDatabaseConnection({ ...database("postgres"), appName: "" }, "password"))
      .toThrow("Database endpoint is unavailable");
  });

  it.each([0, -1, 65536, 12.5, NaN])("rejects invalid endpoint port %s", (port) => {
    expect(() => buildDatabaseConnection(database("postgres"), "password", { host: "db.test", port }))
      .toThrow("Database endpoint is unavailable");
  });
});

describe("connectionString", () => {
  it("reuses the encoded internal connection builder", () => {
    const db = { ...database("postgres"), databasePassword: "p@:/?#%", externalPort: 15432 } as Database;
    expect(connectionString(db)).toBe(buildDatabaseConnection(db, db.databasePassword!).uri);
  });

  it("returns no connection string when the internal hostname is unavailable", () => {
    const db = { ...database("postgres"), appName: "", name: "display-name" } as Database;
    expect(connectionString(db)).toBeNull();
  });
});
