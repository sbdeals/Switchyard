import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getManagedBridgeDatabase } from "./dokploy";
import { DatabaseExecUncertainError, inspectComposeDatabase, streamDatabaseExec } from "./docker";
import { backupFilename } from "./bridge-backup-commands";
import {
  createBridgeDatabaseBackup, listBridgeDatabaseBackups, openBridgeDatabaseBackup, restoreBridgeDatabaseBackup,
} from "./bridge-backups";

vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({ getManagedBridgeDatabase: vi.fn() }));
vi.mock("./docker", () => ({
  DatabaseExecUncertainError: class extends Error {},
  inspectComposeDatabase: vi.fn(), streamDatabaseExec: vi.fn(),
}));

const authorize = vi.mocked(getManagedBridgeDatabase);
const inspect = vi.mocked(inspectComposeDatabase);
const execute = vi.mocked(streamDatabaseExec);
const id = "owned-compose-id";
const appName = "postgres-owned";
const password = 'private-db-password "\\$value';
const dump = Buffer.from([0x50, 0x47, 0x44, 0x4d, 0x50, 0, 1, 2, 255]);
const filename = backupFilename("postgres", new Date("2026-01-01T00:00:00.000Z"));
let root: string;

function databaseDir() {
  return path.join(root, appName);
}

async function seedBackups(count: number): Promise<string[]> {
  await mkdir(databaseDir(), { recursive: true });
  const names = Array.from({ length: count }, (_, i) => backupFilename("postgres", new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i))));
  await Promise.all(names.map((name) => writeFile(path.join(databaseDir(), name), dump)));
  return names;
}

async function bytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), "switchyard-backups-test-"));
  vi.stubEnv("SWITCHYARD_BACKUP_DIR", root);
  authorize.mockResolvedValue({ appName, engine: "postgres" });
  inspect.mockResolvedValue({
    id: "database-container", env: { POSTGRES_DB: "app", POSTGRES_USER: "app", POSTGRES_PASSWORD: password },
  });
  execute.mockImplementation(async (_container, _command, io) => {
    if (io.output) await pipeline(Readable.from([dump]), io.output);
    if (io.input) await bytes(io.input);
    return { exitCode: 0 };
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("bridge backup authorization", () => {
  it("authorizes list, create, restore and download before touching disk or Docker", async () => {
    const missingRoot = path.join(root, "must-not-exist");
    vi.stubEnv("SWITCHYARD_BACKUP_DIR", missingRoot);
    authorize.mockRejectedValue(new Error("Service not found"));
    const operations = [
      () => listBridgeDatabaseBackups(id),
      () => createBridgeDatabaseBackup(id),
      () => restoreBridgeDatabaseBackup(id, filename),
      () => openBridgeDatabaseBackup(id, filename),
    ];
    for (const operation of operations) await expect(operation()).rejects.toThrow("Service not found");
    expect(authorize.mock.calls).toEqual(Array.from({ length: 4 }, () => [id]));
    expect(inspect).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    await expect(lstat(missingRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(root)).toEqual([]);
  });
});

describe("bridge backup storage", () => {
  it("streams a complete private file, lists its metadata and downloads the original bytes", async () => {
    await createBridgeDatabaseBackup(id);
    expect(inspect).toHaveBeenCalledWith(appName, "postgres");
    expect(execute).toHaveBeenCalledWith("database-container", expect.objectContaining({
      cmd: expect.arrayContaining(["pg_dump", "-Fc"]), env: [`PGPASSWORD=${password}`],
    }), expect.objectContaining({ output: expect.anything(), stderr: expect.any(Function) }));
    const backups = await listBridgeDatabaseBackups(id);
    expect(backups).toHaveLength(1);
    expect(backups[0].size).toBe(dump.length);
    expect(backups[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await readdir(databaseDir())).toEqual([backups[0].filename]);
    expect((await lstat(path.join(databaseDir(), backups[0].filename))).mode & 0o777).toBe(0o600);
    const download = await openBridgeDatabaseBackup(id, backups[0].filename);
    expect(download.size).toBe(dump.length);
    expect(await bytes(download.stream)).toEqual(dump);
  });

  it("returns an empty list before the first backup without creating a directory", async () => {
    expect(await listBridgeDatabaseBackups(id)).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it("prunes the oldest backup only after an eleventh successful dump is published", async () => {
    const originals = await seedBackups(10);
    await writeFile(path.join(databaseDir(), "operator-notes.txt"), "keep");
    await createBridgeDatabaseBackup(id);
    const backups = await listBridgeDatabaseBackups(id);
    expect(backups).toHaveLength(10);
    expect(backups.map((backup) => backup.filename)).not.toContain(originals[0]);
    expect(backups.map((backup) => backup.filename)).toEqual(expect.arrayContaining(originals.slice(1)));
    await expect(lstat(path.join(databaseDir(), originals[0]))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(databaseDir(), "operator-notes.txt"), "utf8")).toBe("keep");
  });

  it("deletes a failed partial dump and leaves every existing backup untouched", async () => {
    const originals = await seedBackups(11);
    execute.mockImplementationOnce(async (_container, _command, io) => {
      await pipeline(Readable.from([Buffer.from("incomplete dump")]), io.output!);
      io.stderr(Buffer.from("database connection lost"));
      return { exitCode: 7 };
    });
    await expect(createBridgeDatabaseBackup(id)).rejects.toThrow("Backup failed (exit code 7)");
    expect((await readdir(databaseDir())).sort()).toEqual(originals);
    for (const name of originals) expect(await readFile(path.join(databaseDir(), name))).toEqual(dump);
  });

  it("rejects an empty successful dump and removes both the partial file and operation lock", async () => {
    execute.mockImplementationOnce(async (_container, _command, io) => {
      await pipeline(Readable.from([]), io.output!);
      return { exitCode: 0 };
    });
    await expect(createBridgeDatabaseBackup(id)).rejects.toThrow("empty backup");
    expect(await readdir(databaseDir())).toEqual([]);
  });

  it("streams stored bytes into restore stdin and keeps the backup file", async () => {
    await seedBackups(1);
    let restored: Buffer | undefined;
    execute.mockImplementationOnce(async (_container, command, io) => {
      expect(command.cmd).toEqual(expect.arrayContaining(["pg_restore", "--clean", "--if-exists"]));
      expect(io.output).toBeUndefined();
      restored = await bytes(io.input!);
      return { exitCode: 0 };
    });
    await restoreBridgeDatabaseBackup(id, filename);
    expect(restored).toEqual(dump);
    expect(await readdir(databaseDir())).toEqual([filename]);
    expect(await readFile(path.join(databaseDir(), filename))).toEqual(dump);
  });

  it("serializes backup and restore for a database while allowing reads of completed files", async () => {
    await seedBackups(1);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    execute.mockImplementationOnce(async (_container, _command, io) => {
      entered();
      await resume;
      await pipeline(Readable.from([dump]), io.output!);
      return { exitCode: 0 };
    });
    const pending = createBridgeDatabaseBackup(id);
    try {
      await started;
      await expect(createBridgeDatabaseBackup(id)).rejects.toThrow("already in progress");
      await expect(restoreBridgeDatabaseBackup(id, filename)).rejects.toThrow("already in progress");
      expect(await listBridgeDatabaseBackups(id)).toHaveLength(1);
      expect(await bytes((await openBridgeDatabaseBackup(id, filename)).stream)).toEqual(dump);
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await pending;
    }
    await createBridgeDatabaseBackup(id);
    expect(await listBridgeDatabaseBackups(id)).toHaveLength(3);
    expect(await readdir(databaseDir())).not.toContain(".operation.lock");
  });
});

describe("bridge backup path validation", () => {
  it.each([`../${filename}`, `/tmp/${filename}`, `..\\${filename}`, `${filename}\n`, "2026-01-01T00-00-00.000Z.sql"])(
    "rejects traversal, noncanonical names and the wrong engine extension: %s", async (name) => {
      await expect(openBridgeDatabaseBackup(id, name)).rejects.toThrow("Invalid backup filename");
      await expect(restoreBridgeDatabaseBackup(id, name)).rejects.toThrow("Invalid backup filename");
      expect(inspect).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual([]);
    }
  );

  it("rejects traversing service directory names even when returned by the service lookup", async () => {
    authorize.mockResolvedValue({ appName: "../outside", engine: "postgres" });
    await expect(createBridgeDatabaseBackup(id)).rejects.toThrow("Invalid database backup directory name");
    await expect(listBridgeDatabaseBackups(id)).rejects.toThrow("Invalid database backup directory name");
    expect(await readdir(root)).toEqual([]);
  });

  it("does not follow symlinks in place of the database directory", async () => {
    const external = path.join(root, "external");
    await mkdir(external);
    await writeFile(path.join(external, filename), dump);
    await symlink(external, databaseDir());
    for (const operation of [
      () => createBridgeDatabaseBackup(id), () => listBridgeDatabaseBackups(id),
      () => restoreBridgeDatabaseBackup(id, filename), () => openBridgeDatabaseBackup(id, filename),
    ]) await expect(operation()).rejects.toThrow("real directory");
    expect(inspect).not.toHaveBeenCalled();
    expect(await readdir(external)).toEqual([filename]);
  });

  it("excludes symlinked backup files from listings and refuses download and restore", async () => {
    await mkdir(databaseDir());
    const external = path.join(root, "secret.dump");
    await writeFile(external, dump);
    await symlink(external, path.join(databaseDir(), filename));
    expect(await listBridgeDatabaseBackups(id)).toEqual([]);
    await expect(openBridgeDatabaseBackup(id, filename)).rejects.toMatchObject({ code: "ELOOP" });
    await expect(restoreBridgeDatabaseBackup(id, filename)).rejects.toMatchObject({ code: "ELOOP" });
    expect(inspect).not.toHaveBeenCalled();
    expect(await readFile(external)).toEqual(dump);
    expect(await readdir(databaseDir())).toEqual([filename]);
  });
});

describe("bridge backup failures", () => {
  it("retains the operation lock when Docker cannot verify that the database tool stopped", async () => {
    execute.mockRejectedValueOnce(new DatabaseExecUncertainError("Database exec completion could not be verified"));
    await expect(createBridgeDatabaseBackup(id)).rejects.toThrow("completion could not be verified");
    expect(await readdir(databaseDir())).toEqual([".operation.lock"]);
    await expect(createBridgeDatabaseBackup(id)).rejects.toThrow("already in progress");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("redacts credentials across stderr chunks and reports exit status and actionable diagnostics", async () => {
    inspect.mockResolvedValue({
      id: "database-container", env: {
        POSTGRES_DB: "app", POSTGRES_USER: "app", POSTGRES_PASSWORD: password, API_TOKEN: "other-private-token",
      },
    });
    execute.mockImplementationOnce(async (_container, _command, io) => {
      await pipeline(Readable.from([dump]), io.output!);
      const encoded = JSON.stringify(password);
      io.stderr(Buffer.from(`authentication failed: ${password.slice(0, 12)}`));
      io.stderr(Buffer.from(`${password.slice(12)} ${encoded} other-private-token`));
      return { exitCode: 2, error: `connection rejected ${encodeURIComponent(password)}` };
    });
    let message = "";
    try { await createBridgeDatabaseBackup(id); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("exit code 2");
    expect(message).toContain("authentication failed");
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain(password);
    expect(message).not.toContain(JSON.stringify(password));
    expect(message).not.toContain(encodeURIComponent(password));
    expect(message).not.toContain("other-private-token");
    expect(await readdir(databaseDir())).toEqual([]);
  });

  it("does not expose a partial credential at the beginning of a truncated stderr tail", async () => {
    execute.mockImplementationOnce(async (_container, _command, io) => {
      await pipeline(Readable.from([dump]), io.output!);
      io.stderr(Buffer.from("noise".repeat(4_000)));
      io.stderr(Buffer.from(`private-db-password ${password} ${"x".repeat(8_400)}\ncheck database health`));
      return { exitCode: 1 };
    });
    let message = "";
    try { await createBridgeDatabaseBackup(id); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("check database health");
    expect(message).not.toContain("private-db-password");
    expect(message).not.toContain("$value");
    expect(message.length).toBeLessThan(8_500);
  });
});
