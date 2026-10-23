import "server-only";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { getManagedBridgeDatabase, type Engine } from "./dokploy";
import { DatabaseExecUncertainError, inspectComposeDatabase, streamDatabaseExec } from "./docker";
import {
  backupExtension, backupFilename, backupsToPrune, buildBackupCommand,
  parseBackupFilename, redactBackupError, validateBackupAppName, type BackupOperation,
} from "./bridge-backup-commands";

export interface BridgeDatabaseBackup {
  filename: string;
  createdAt: string;
  size: number;
}

type DatabaseTarget = { appName: string; engine: Engine };
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

async function directory(target: DatabaseTarget, create = false): Promise<string> {
  validateBackupAppName(target.appName);
  backupExtension(target.engine); // Redis is explicitly unsupported, including direct requests.
  const root = path.resolve(process.env.SWITCHYARD_BACKUP_DIR || path.join(process.cwd(), "data", "backups"));
  const dir = path.join(root, target.appName);
  if (create) await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    if (!(await lstat(dir)).isDirectory()) throw new Error("Backup directory must be a real directory, not a symlink.");
  } catch (e) {
    if (code(e) !== "ENOENT") throw e;
  }
  return dir;
}

function checkFilename(target: DatabaseTarget, filename: string): void {
  if (typeof filename !== "string" || parseBackupFilename(filename)?.extension !== backupExtension(target.engine)) {
    throw new Error("Invalid backup filename for this database engine.");
  }
}

async function readBackups(target: DatabaseTarget, dir: string): Promise<BridgeDatabaseBackup[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (code(e) === "ENOENT") return [];
    throw e;
  }
  const backups: BridgeDatabaseBackup[] = [];
  for (const entry of entries) {
    const parsed = parseBackupFilename(entry.name);
    if (!entry.isFile() || parsed?.extension !== backupExtension(target.engine)) continue;
    try {
      const stat = await lstat(path.join(dir, entry.name));
      if (stat.isFile()) backups.push({ filename: entry.name, createdAt: parsed.timestamp, size: stat.size });
    } catch (e) {
      if (code(e) !== "ENOENT") throw e; // A concurrent successful backup may prune this file.
    }
  }
  return backups.sort((a, b) => b.filename.localeCompare(a.filename));
}

/** Every public entry point resolves the service using the current user's session. */
export async function listBridgeDatabaseBackups(id: string): Promise<BridgeDatabaseBackup[]> {
  const target = await getManagedBridgeDatabase(id);
  return readBackups(target, await directory(target));
}

/** An exclusive on-disk lock also serializes mutations across dashboard workers. */
async function withDatabaseLock<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const lockPath = path.join(dir, ".operation.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (e) {
    if (code(e) === "EEXIST") {
      throw new Error("A backup or restore is already in progress. If the dashboard restarted, ask the operator to verify no database tool is running before removing .operation.lock from this database's backup directory.");
    }
    throw e;
  }
  let release = true;
  try {
    return await run();
  } catch (e) {
    if (e instanceof DatabaseExecUncertainError) release = false;
    throw e;
  } finally {
    await lock.close();
    if (release) await unlink(lockPath);
  }
}

async function runDatabaseTool(
  target: DatabaseTarget,
  operation: BackupOperation,
  io: { input?: Readable; output?: Writable },
): Promise<void> {
  const container = await inspectComposeDatabase(target.appName, target.engine);
  const command = buildBackupCommand(target.engine, operation, container.env);
  const secrets = [...command.secrets, ...Object.entries(container.env)
    .filter(([key]) => /password|secret|token|credential|uri|url/i.test(key)).map(([, value]) => value)];
  // Keep enough overlap to redact a credential split across stderr chunks, or
  // at the start of the bounded tail. Encodings can expand each character.
  const overlap = Math.max(0, ...secrets.map((value) => value.length * 12));
  const limit = 8192 + overlap;
  let tail = Buffer.alloc(0);
  let truncated = false;
  const stderrTail = () => {
    const redacted = redactBackupError(tail.toString("utf8"), secrets);
    return (truncated ? redacted.slice(overlap) : redacted).slice(-8192).trim();
  };
  try {
    const result = await streamDatabaseExec(container.id, command, {
      ...io,
      stderr(chunk) {
        truncated ||= tail.length + chunk.length > limit;
        tail = Buffer.concat([tail, chunk.subarray(-limit)]).subarray(-limit);
      },
    });
    if (result.exitCode !== 0 || result.error) {
      const stderr = stderrTail();
      const status = result.exitCode === null ? "unknown (completion could not be verified)" : String(result.exitCode);
      throw new Error(`${operation === "backup" ? "Backup" : "Restore"} failed (exit code ${status}). ${result.error ?? "Check that the database is healthy and its credentials match the running container."}${stderr ? `\n${stderr}` : ""}`);
    }
  } catch (e) {
    const message = redactBackupError(e instanceof Error ? e.message : "Database backup operation failed.", secrets);
    if (e instanceof DatabaseExecUncertainError) {
      const stderr = stderrTail();
      throw new DatabaseExecUncertainError(`${message}${stderr ? `\n${stderr}` : ""}`);
    }
    throw new Error(message);
  }
}

export async function createBridgeDatabaseBackup(id: string): Promise<void> {
  const target = await getManagedBridgeDatabase(id);
  const dir = await directory(target, true);
  await withDatabaseLock(dir, async () => {
    // Millisecond timestamps are normally unique. Do not overwrite a backup if
    // the clock moved backwards or two requests land in the same millisecond.
    const backups = await readBackups(target, dir);
    const latest = backups[0] ? Date.parse(backups[0].createdAt) : 0;
    const filename = backupFilename(target.engine, new Date(Math.max(Date.now(), latest + 1)));
    const partial = path.join(dir, `.${filename}.partial`);
    const handle = await open(partial, "wx", 0o600);
    const output = handle.createWriteStream();
    try {
      await runDatabaseTool(target, "backup", { output });
      if ((await lstat(partial)).size === 0) throw new Error("The dump tool returned an empty backup. Check the database logs and retry.");
      await rename(partial, path.join(dir, filename));
      const completed = await readBackups(target, dir);
      for (const old of backupsToPrune(completed.map((backup) => backup.filename))) {
        await unlink(path.join(dir, old));
      }
    } finally {
      output.destroy();
      await handle.close();
      await unlink(partial).catch((e) => { if (code(e) !== "ENOENT") throw e; });
    }
  });
}

/** Open before streaming so missing files are errors, and never follow symlinks. */
async function openFile(target: DatabaseTarget, filename: string) {
  checkFilename(target, filename);
  const dir = await directory(target);
  const handle = await open(path.join(dir, filename), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0) throw new Error("Backup is not a nonempty regular file.");
    return { handle, size: stat.size };
  } catch (e) {
    await handle.close();
    throw e;
  }
}

export async function restoreBridgeDatabaseBackup(id: string, filename: string): Promise<void> {
  const target = await getManagedBridgeDatabase(id);
  checkFilename(target, filename);
  const dir = await directory(target, true);
  await withDatabaseLock(dir, async () => {
    const { handle } = await openFile(target, filename);
    const input = handle.createReadStream();
    try {
      await runDatabaseTool(target, "restore", { input });
    } finally {
      input.destroy();
      await handle.close();
    }
  });
}

export async function openBridgeDatabaseBackup(id: string, filename: string) {
  const target = await getManagedBridgeDatabase(id);
  const { handle, size } = await openFile(target, filename);
  return { stream: handle.createReadStream(), size };
}
