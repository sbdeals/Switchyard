import { describe, expect, it } from "vitest";
import type { Engine } from "@/lib/dokploy";
import {
  backupExtension, backupFilename, backupsToPrune, buildBackupCommand,
  parseBackupFilename, redactBackupError, validateBackupAppName,
} from "./bridge-backup-commands";

const password = 'private-credential-"\\\n$(touch /tmp/nope); # value';
const env = {
  POSTGRES_USER: "app", POSTGRES_DB: "app_db", POSTGRES_PASSWORD: password,
  MYSQL_USER: "app", MYSQL_DATABASE: "app_db", MYSQL_PASSWORD: "unused-app-password", MYSQL_ROOT_PASSWORD: password,
  MARIADB_USER: "app", MARIADB_DATABASE: "app_db", MARIADB_PASSWORD: "unused-app-password", MARIADB_ROOT_PASSWORD: password,
  MONGO_INITDB_ROOT_USERNAME: "root", MONGO_INITDB_ROOT_PASSWORD: password,
};
const engines: Engine[] = ["postgres", "mysql", "mariadb", "mongo"];

describe("buildBackupCommand", () => {
  it.each(engines)("keeps %s passwords out of backup and restore argv", (engine) => {
    for (const operation of ["backup", "restore"] as const) {
      const command = buildBackupCommand(engine, operation, env);
      for (const arg of command.cmd) {
        expect(arg).not.toContain(password);
        expect(arg).not.toContain(JSON.stringify(password));
        expect(arg).not.toContain("--password=");
        expect(arg).not.toContain("$(touch /tmp/nope)");
      }
      expect(command.secrets).toContain(password);
      expect(command.env.join("\n")).not.toContain("unused-app-password");
    }
  });

  it("uses PostgreSQL custom dumps and restores the same database, failing on SQL errors", () => {
    const backup = buildBackupCommand("postgres", "backup", env);
    expect(backup.cmd).toEqual([
      "pg_dump", "-Fc", "--no-password", "--host=127.0.0.1", "--username=app", "--dbname=app_db",
    ]);
    expect(backup.env).toEqual([`PGPASSWORD=${password}`]);
    const restore = buildBackupCommand("postgres", "restore", env);
    expect(restore.cmd).toEqual([
      "pg_restore", "--clean", "--if-exists", "--exit-on-error", "--no-password",
      "--host=127.0.0.1", "--username=app", "--dbname=app_db",
    ]);
    expect(restore.env).toEqual(backup.env);
  });

  it.each(["mysql", "mariadb"] as const)("backs up %s routines with root and streams SQL through stdin on restore", (engine) => {
    const backup = buildBackupCommand(engine, "backup", env);
    expect(backup.cmd[0]).toBe(engine === "mysql" ? "mysqldump" : "mariadb-dump");
    expect(backup.cmd).toEqual(expect.arrayContaining([
      "--user=root", "--single-transaction", "--routines", "--events", "--no-tablespaces", "app_db",
    ]));
    expect(backup.env).toEqual([`MYSQL_PWD=${password}`]);
    const restore = buildBackupCommand(engine, "restore", env);
    expect(restore.cmd).toEqual([
      engine, "--host=localhost", "--user=root", "--binary-mode=1", "--database=app_db",
    ]);
    expect(restore.env).toEqual(backup.env);
    expect(backup.cmd.includes("--set-gtid-purged=OFF")).toBe(engine === "mysql");
  });

  it("uses a private Mongo config with a JSON-escaped password and cleanup on exit", () => {
    const backup = buildBackupCommand("mongo", "backup", env);
    expect(backup.cmd.slice(0, 3)).toEqual(["sh", "-eu", "-c"]);
    const script = backup.cmd[3];
    expect(script).toContain("umask 077\n");
    expect(script).toContain("mktemp /tmp/switchyard-backup.XXXXXX");
    expect(script).toContain('trap \'rm -f "$config"\' EXIT');
    expect(script).toContain('printf \'password: %s\\n\' "$SWITCHYARD_MONGO_PASSWORD_JSON" > "$config"');
    expect(script).toContain('"$@" --config="$config"');
    expect(script).not.toContain("eval");
    expect(backup.cmd).toEqual(expect.arrayContaining([
      "mongodump", "--host=127.0.0.1", "--username=root", "--authenticationDatabase=admin", "--archive", "--gzip",
    ]));
    expect(backup.env).toEqual([`SWITCHYARD_MONGO_PASSWORD_JSON=${JSON.stringify(password)}`]);
    expect(JSON.parse(backup.env[0].slice(backup.env[0].indexOf("=") + 1))).toBe(password);
  });

  it("restores Mongo collections without replacing current instance credentials or internal databases", () => {
    const restore = buildBackupCommand("mongo", "restore", env);
    expect(restore.cmd).toEqual(expect.arrayContaining([
      "mongorestore", "--drop", "--stopOnError", "--archive", "--gzip",
      "--nsExclude=admin.*", "--nsExclude=config.*", "--nsExclude=local.*",
    ]));
  });

  it("escapes Unicode line separators and control characters for Mongo's YAML parser", () => {
    const unicodePassword = "secret\u0085\u007f\u2028\u2029value";
    const backup = buildBackupCommand("mongo", "backup", { ...env, MONGO_INITDB_ROOT_PASSWORD: unicodePassword });
    const encoded = backup.env[0].slice(backup.env[0].indexOf("=") + 1);
    expect(encoded).toBe('"secret\\u0085\\u007f\\u2028\\u2029value"');
    expect(JSON.parse(encoded)).toBe(unicodePassword);
    expect(backup.secrets).toContain(encoded);
  });

  it.each(engines)("rejects missing %s container credentials", (engine) => {
    expect(() => buildBackupCommand(engine, "backup", {})).toThrow("running database container");
  });

  it.each([
    ["postgres", "POSTGRES_DB", "host=attacker password=leak"],
    ["postgres", "POSTGRES_USER", "app\n"],
    ["mysql", "MYSQL_DATABASE", "--all-databases"],
    ["mariadb", "MARIADB_DATABASE", "app; rm -rf /"],
    ["mongo", "MONGO_INITDB_ROOT_USERNAME", "root\0injected"],
  ])("rejects unsafe %s %s without reflecting its value", (engine, key, value) => {
    expect(() => buildBackupCommand(engine as Engine, "backup", { ...env, [key]: value })).toThrow();
    try {
      buildBackupCommand(engine as Engine, "backup", { ...env, [key]: value });
    } catch (error) {
      expect((error as Error).message).not.toContain(value);
    }
  });

  it("rejects NUL passwords instead of passing invalid exec environment", () => {
    expect(() => buildBackupCommand("postgres", "backup", { ...env, POSTGRES_PASSWORD: "secret\0value" })).toThrow("POSTGRES_PASSWORD");
  });

  it("reports unsupported Redis backups explicitly", () => {
    expect(() => buildBackupCommand("redis", "backup", {})).toThrow("not supported yet");
    expect(() => buildBackupCommand("redis", "restore", {})).toThrow("not supported yet");
    expect(() => backupExtension("redis")).toThrow("not supported yet");
  });
});

describe("backup filenames", () => {
  const date = new Date("2026-10-23T12:34:56.789Z");

  it.each([
    ["postgres", "dump"], ["mysql", "sql"], ["mariadb", "sql"], ["mongo", "archive.gz"],
  ] as const)("uses a strict UTC timestamp and %s extension", (engine, extension) => {
    const filename = backupFilename(engine, date);
    expect(filename).toBe(`2026-10-23T12-34-56.789Z.${extension}`);
    expect(backupExtension(engine)).toBe(extension);
    expect(parseBackupFilename(filename)).toEqual({ timestamp: date.toISOString(), extension });
  });

  it.each([
    "", "../2026-10-23T12-34-56.789Z.dump", "/2026-10-23T12-34-56.789Z.dump",
    "..\\2026-10-23T12-34-56.789Z.dump", "%2e%2e%2f2026-10-23T12-34-56.789Z.dump",
    "2026-10-23T12-34-56.789Z.dump/../secret", "2026-10-23T12-34-56.789Z.dump\0",
    "2026-10-23T12-34-56.789Z.dump\n", "2026-10-23T12-34-56.789Z.dump\r\n",
    "2026-10-23T12-34-56.789Z.dump.part", "2026-10-23T12:34:56.789Z.dump",
    "2026-10-23T12-34-56Z.dump", "2026-10-23T12-34-56.789+00:00.dump",
    "2026-10-23T12-34-56.789Z.txt", "2026-02-29T12-34-56.789Z.sql",
    "2026-02-30T12-34-56.789Z.sql", "2026-13-23T12-34-56.789Z.sql",
    "2026-10-23T24-34-56.789Z.sql", "2026-10-23T12-34-60.789Z.sql",
  ])("rejects malformed, non-canonical, and traversing filenames: %s", (name) => {
    expect(parseBackupFilename(name)).toBeNull();
  });

  it("accepts leap days only in leap years", () => {
    expect(parseBackupFilename("2024-02-29T00-00-00.000Z.sql")?.timestamp).toBe("2024-02-29T00:00:00.000Z");
  });

  it("rejects invalid and extended-year timestamps", () => {
    expect(() => backupFilename("postgres", new Date("invalid"))).toThrow("Invalid backup timestamp");
    expect(() => backupFilename("postgres", new Date("+010000-01-01T00:00:00.000Z"))).toThrow("Invalid backup timestamp");
  });
});

describe("validateBackupAppName", () => {
  it.each(["database-x1", "postgres_42", "db", "0db", "Database"])("accepts %s as one directory component", (name) => {
    expect(() => validateBackupAppName(name)).not.toThrow();
  });

  it.each(["", ".", "..", "../db", "db/../other", "/db", "db\\other", "%2e%2e", ".hidden", "db\n", "db\0", "a".repeat(129)])(
    "rejects invalid and traversing directory names: %s", (name) => {
      expect(() => validateBackupAppName(name)).toThrow("Invalid database backup directory name");
    }
  );
});

describe("backupsToPrune", () => {
  const filenames = Array.from({ length: 12 }, (_, i) => backupFilename("postgres", new Date(Date.UTC(2026, 9, 23, 0, 0, 0, i))));

  it("keeps the latest ten independent of directory listing order", () => {
    const input = [...filenames].reverse();
    expect(backupsToPrune(input)).toEqual(filenames.slice(0, 2));
    expect(input).toEqual([...filenames].reverse());
  });

  it("ignores partial, unrelated, invalid and traversing names, and duplicates", () => {
    const unrelated = ["README", `${filenames[0]}.part`, `../${filenames[0]}`, "2026-02-30T00-00-00.000Z.dump"];
    expect(backupsToPrune([...filenames, filenames[11], ...unrelated])).toEqual(filenames.slice(0, 2));
  });

  it("does not prune databases below the retention count", () => {
    expect(backupsToPrune(filenames.slice(0, 10))).toEqual([]);
    expect(backupsToPrune([])).toEqual([]);
  });

  it("supports an explicit retention count including zero", () => {
    expect(backupsToPrune(filenames, 2)).toEqual(filenames.slice(0, 10));
    expect(backupsToPrune(filenames, 0)).toEqual(filenames);
  });

  it.each([-1, 1.5, Infinity, NaN])("rejects invalid retention count %s", (keep) => {
    expect(() => backupsToPrune(filenames, keep)).toThrow("Invalid backup retention count");
  });
});

describe("redactBackupError", () => {
  it("redacts raw, JSON-escaped, URL-encoded and form-encoded credentials", () => {
    const secret = 'private value "\\\n';
    const encoded = encodeURIComponent(secret);
    const message = [secret, JSON.stringify(secret), encoded, encoded.replace(/%20/g, "+")].join(" | ");
    expect(redactBackupError(message, [secret])).toBe('[REDACTED] | "[REDACTED]" | [REDACTED] | [REDACTED]');
  });

  it("keeps actionable error details and ignores empty secrets", () => {
    expect(redactBackupError("pg_dump: connection refused (exit 1)", [""])).toBe("pg_dump: connection refused (exit 1)");
    expect(redactBackupError("password=private-token; exit 2", ["private", "private-token"])).toBe("password=[REDACTED]; exit 2");
  });
});
