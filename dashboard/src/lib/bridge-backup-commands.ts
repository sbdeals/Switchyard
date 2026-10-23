import type { Engine } from "@/lib/dokploy";

export type BackupOperation = "backup" | "restore";
export type BackupExtension = "dump" | "sql" | "archive.gz";

export interface BackupCommand {
  cmd: string[];
  env: string[];
  /** Values to redact from tool errors before returning them to the client. */
  secrets: string[];
}

function required(env: Record<string, string>, key: string): string {
  const value = env[key];
  if (!value || value.includes("\0") || value.length > 16_384) {
    throw new Error(`The running database container has no valid ${key}. Check its variables and redeploy it.`);
  }
  return value;
}

function identifier(env: Record<string, string>, key: string): string {
  const value = required(env, key);
  // Managed databases use simple identifiers. In particular, reject libpq
  // connection strings and option-like database names before invoking a tool.
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(value) || /[\r\n]/.test(value)) {
    throw new Error(`${key} must contain only letters, numbers, underscores, periods, or hyphens and cannot start with a hyphen.`);
  }
  return value;
}

// MongoDB tools have no password environment variable. Keep it in a private
// temporary config, written by the shell's printf builtin, never in child argv.
// JSON strings are also YAML scalars, including quotes, newlines, and backslashes.
const MONGO_CONFIG_SCRIPT = `umask 077
config=$(mktemp /tmp/switchyard-backup.XXXXXX)
trap 'rm -f "$config"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'password: %s\\n' "$SWITCHYARD_MONGO_PASSWORD_JSON" > "$config"
"$@" --config="$config"`;

/** Build a dump/restore invocation using the running container's environment. */
export function buildBackupCommand(
  engine: Engine,
  operation: BackupOperation,
  containerEnv: Record<string, string>,
): BackupCommand {
  if (operation !== "backup" && operation !== "restore") throw new Error("Invalid backup operation.");
  switch (engine) {
    case "postgres": {
      const password = required(containerEnv, "POSTGRES_PASSWORD");
      const connection = [
        "--no-password", "--host=127.0.0.1",
        `--username=${identifier(containerEnv, "POSTGRES_USER")}`,
        `--dbname=${identifier(containerEnv, "POSTGRES_DB")}`,
      ];
      return {
        cmd: operation === "backup"
          ? ["pg_dump", "-Fc", ...connection]
          : ["pg_restore", "--clean", "--if-exists", "--exit-on-error", ...connection],
        env: [`PGPASSWORD=${password}`],
        secrets: [password],
      };
    }
    case "mysql":
    case "mariadb": {
      const prefix = engine === "mysql" ? "MYSQL" : "MARIADB";
      // Root can read routines and restore their DEFINER clauses. The managed
      // application user does not have all of those privileges.
      const password = required(containerEnv, `${prefix}_ROOT_PASSWORD`);
      const database = identifier(containerEnv, `${prefix}_DATABASE`);
      const connection = ["--host=localhost", "--user=root"];
      return {
        cmd: operation === "backup"
          ? [engine === "mysql" ? "mysqldump" : "mariadb-dump", ...connection,
            "--single-transaction", "--routines", "--events", "--no-tablespaces",
            ...(engine === "mysql" ? ["--set-gtid-purged=OFF"] : []), database]
          : [engine === "mysql" ? "mysql" : "mariadb", ...connection, "--binary-mode=1", `--database=${database}`],
        env: [`MYSQL_PWD=${password}`],
        secrets: [password],
      };
    }
    case "mongo": {
      const password = required(containerEnv, "MONGO_INITDB_ROOT_PASSWORD");
      const passwordJson = JSON.stringify(password).replace(/[\u007f-\u009f\u2028\u2029]/g,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
      return {
        cmd: ["sh", "-eu", "-c", MONGO_CONFIG_SCRIPT, "switchyard-backup",
          operation === "backup" ? "mongodump" : "mongorestore",
          "--host=127.0.0.1", `--username=${identifier(containerEnv, "MONGO_INITDB_ROOT_USERNAME")}`,
          "--authenticationDatabase=admin", "--archive", "--gzip",
          // Keep the running service's credentials when restoring an old dump.
          ...(operation === "restore" ? ["--drop", "--stopOnError", "--nsExclude=admin.*", "--nsExclude=config.*", "--nsExclude=local.*"] : [])],
        env: [`SWITCHYARD_MONGO_PASSWORD_JSON=${passwordJson}`],
        secrets: [password, passwordJson],
      };
    }
    case "redis":
      throw new Error("Backups for bridge Redis databases are not supported yet.");
    default:
      throw new Error("Unsupported database engine.");
  }
}

export function backupExtension(engine: Engine): BackupExtension {
  switch (engine) {
    case "postgres": return "dump";
    case "mysql":
    case "mariadb": return "sql";
    case "mongo": return "archive.gz";
    case "redis": throw new Error("Backups for bridge Redis databases are not supported yet.");
    default: throw new Error("Unsupported database engine.");
  }
}

const BACKUP_FILENAME = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)\.(dump|sql|archive\.gz)$/;

export function parseBackupFilename(name: string): { timestamp: string; extension: BackupExtension } | null {
  const match = BACKUP_FILENAME.exec(name);
  if (!match || match[0] !== name) return null;
  const timestamp = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3");
  const date = new Date(timestamp);
  // Date parsing normalizes values such as February 30; reject those as well.
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) return null;
  return { timestamp, extension: match[2] as BackupExtension };
}

export function backupFilename(engine: Engine, date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid backup timestamp.");
  const name = `${date.toISOString().replace(/:/g, "-")}.${backupExtension(engine)}`;
  if (!parseBackupFilename(name)) throw new Error("Invalid backup timestamp.");
  return name;
}

/** A single directory component; never a path or a hidden/parent directory. */
export function validateBackupAppName(appName: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(appName) || /[\r\n]/.test(appName)) {
    throw new Error("Invalid database backup directory name.");
  }
}

/** Oldest first. Ignore incomplete dumps and any unrelated files. */
export function backupsToPrune(filenames: string[], keep = 10): string[] {
  if (!Number.isSafeInteger(keep) || keep < 0) throw new Error("Invalid backup retention count.");
  const backups = [...new Set(filenames)].filter((name) => parseBackupFilename(name) !== null).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}

/** Scrub raw credentials and the encodings database tools may use in errors. */
export function redactBackupError(message: string, secrets: string[]): string {
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    variants.add(secret);
    variants.add(JSON.stringify(secret).slice(1, -1));
    try {
      const encoded = encodeURIComponent(secret);
      variants.add(encoded);
      variants.add(encoded.replace(/%20/g, "+"));
    } catch { /* Invalid Unicode still has raw and JSON representations above. */ }
  }
  let redacted = message;
  for (const secret of [...variants].sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}
