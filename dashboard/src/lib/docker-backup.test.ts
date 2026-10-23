import { Duplex, Readable, Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => ({ getContainer: vi.fn(), listContainers: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("dockerode", () => ({ default: function Docker() { return docker; } }));

import { DatabaseExecUncertainError, inspectComposeDatabase, streamDatabaseExec } from "./docker";

const command = { cmd: ["pg_restore", "--dbname=app"], env: ["PGPASSWORD=private"] };

function frame(stream: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function mockExec(raw: Duplex, exitCode = 0) {
  const exec = {
    start: vi.fn().mockResolvedValue(raw),
    inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: exitCode }),
  };
  const create = vi.fn().mockResolvedValue(exec);
  docker.getContainer.mockReturnValue({ exec: create });
  return { ...exec, create };
}

describe("streamDatabaseExec", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("streams binary dump output separately from stderr and checks the process exit", async () => {
    const dump = Buffer.from([0, 255, 128, 10]);
    const stderr: Buffer[] = [];
    const output: Buffer[] = [];
    const raw = new Duplex({
      read() {
        this.push(frame(1, dump));
        this.push(frame(2, Buffer.from("warning\n")));
        this.push(null);
      },
      write(_chunk, _encoding, done) { done(); },
    });
    const exec = mockExec(raw);
    const result = await streamDatabaseExec("db-container", command, {
      output: new Writable({ write(chunk, _encoding, done) { output.push(chunk); done(); } }),
      stderr: (chunk) => stderr.push(chunk),
    });
    expect(result).toEqual({ exitCode: 0 });
    expect(Buffer.concat(output)).toEqual(dump);
    expect(Buffer.concat(stderr).toString()).toBe("warning\n");
    expect(exec.create).toHaveBeenCalledWith({
      Cmd: command.cmd, Env: command.env, AttachStdin: false, AttachStdout: true, AttachStderr: true, Tty: false,
    });
    expect(exec.start).toHaveBeenCalledWith({ hijack: true, stdin: false, Tty: false, abortSignal: expect.any(AbortSignal) });
    expect(exec.inspect).toHaveBeenCalledOnce();
  });

  it("half-closes restore stdin while continuing to read output and stderr until EOF", async () => {
    const input = [Buffer.from([0, 255, 128]), Buffer.alloc(70_000, 123)];
    const received: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputCompleted = false;
    const raw = new Duplex({
      read() {},
      write(chunk, _encoding, done) { received.push(Buffer.from(chunk)); done(); },
      final(done) {
        done();
        // The database emits diagnostics after it consumes stdin's EOF. A
        // pipeline that destroys both halves at writable finish loses these.
        setImmediate(() => {
          this.push(frame(1, Buffer.from("restored")));
          this.push(frame(2, Buffer.from("restore complete\n")));
          outputCompleted = true;
          this.push(null);
        });
      },
    });
    const exec = mockExec(raw);
    exec.inspect.mockImplementation(async () => {
      expect(outputCompleted).toBe(true);
      return { Running: false, ExitCode: 0 };
    });
    expect(await streamDatabaseExec("db-container", command, {
      input: Readable.from(input), stderr: (chunk) => stderr.push(chunk),
    })).toEqual({ exitCode: 0 });
    expect(Buffer.concat(received)).toEqual(Buffer.concat(input));
    expect(Buffer.concat(stderr).toString()).toBe("restore complete\n");
    expect(raw.writableFinished).toBe(true);
    expect(exec.create).toHaveBeenCalledWith(expect.objectContaining({ AttachStdin: true }));
    expect(exec.start).toHaveBeenCalledWith({ hijack: true, stdin: true, Tty: false, abortSignal: expect.any(AbortSignal) });
  });

  it("returns a nonzero engine exit code after draining its stderr", async () => {
    const stderr: Buffer[] = [];
    const raw = new Duplex({
      read() {
        this.push(frame(2, Buffer.from("authentication failed\n")));
        this.push(null);
      },
      write(_chunk, _encoding, done) { done(); },
    });
    mockExec(raw, 2);
    expect(await streamDatabaseExec("db-container", command, {
      stderr: (chunk) => stderr.push(chunk),
    })).toEqual({ exitCode: 2 });
    expect(Buffer.concat(stderr).toString()).toBe("authentication failed\n");
  });

  it("reports a disk writer failure and destroys the Docker stream", async () => {
    const raw = new Duplex({
      read() { this.push(frame(1, Buffer.from("dump"))); },
      write(_chunk, _encoding, done) { done(); },
    });
    mockExec(raw);
    const result = await streamDatabaseExec("db-container", command, {
      output: new Writable({ write(_chunk, _encoding, done) { done(new Error("no space left on device")); } }),
      stderr: () => {},
    });
    expect(result.error).toContain("no space left on device");
    expect(raw.destroyed).toBe(true);
  });

  it("reports restore file read failures and closes both directions", async () => {
    const raw = new Duplex({
      read() {},
      write(_chunk, _encoding, done) { done(); },
    });
    mockExec(raw);
    const input = new Readable({ read() { this.destroy(new Error("backup file unreadable")); } });
    const result = await streamDatabaseExec("db-container", command, { input, stderr: () => {} });
    expect(result.error).toContain("backup file unreadable");
    expect(raw.destroyed).toBe(true);
    expect(input.destroyed).toBe(true);
  });

  it("waits for the process to exit when it closes stdout before exiting", async () => {
    const raw = new Duplex({
      read() { this.push(null); },
      write(_chunk, _encoding, done) { done(); },
    });
    const exec = mockExec(raw);
    exec.inspect.mockResolvedValueOnce({ Running: true, ExitCode: null });
    expect(await streamDatabaseExec("db-container", command, { stderr: () => {} })).toEqual({ exitCode: 0 });
    expect(exec.inspect).toHaveBeenCalledTimes(2);
  });

  it("marks failed exec startup as uncertain instead of permitting an immediate retry", async () => {
    const raw = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
    const exec = mockExec(raw);
    exec.start.mockRejectedValue(new Error("connection closed during startup"));
    const result = streamDatabaseExec("db-container", command, { stderr: () => {} });
    await expect(result).rejects.toBeInstanceOf(DatabaseExecUncertainError);
    await expect(result).rejects.toThrow("Could not verify database exec startup (exit code unknown)");
    expect(exec.inspect).not.toHaveBeenCalled();
  });

  it("marks lost exec inspection as uncertain even after all output has drained", async () => {
    const raw = new Duplex({
      read() { this.push(null); },
      write(_chunk, _encoding, done) { done(); },
    });
    const exec = mockExec(raw);
    exec.inspect.mockRejectedValue(new Error("Docker daemon disconnected"));
    const result = streamDatabaseExec("db-container", command, { stderr: () => {} });
    await expect(result).rejects.toBeInstanceOf(DatabaseExecUncertainError);
    await expect(result).rejects.toThrow("Database exec completion could not be verified (exit code unknown)");
    expect(exec.inspect).toHaveBeenCalledOnce();
  });
});

describe("inspectComposeDatabase", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function container(id: string, project = "app-123", service = "db", oneoff = "False") {
    return {
      Id: id,
      Labels: {
        "com.docker.compose.project": project,
        "com.docker.compose.service": service,
        "com.docker.compose.oneoff": oneoff,
      },
    };
  }

  it("selects the exact project/service and excludes sidecars, name substrings, and one-off tasks", async () => {
    docker.listContainers.mockResolvedValue([
      container("wrong-project", "app-123-other"),
      container("wrong-service", "app-123", "sidecar"),
      container("oneoff", "app-123", "db", "TRUE"),
      container("database"),
      { Id: "unlabelled", Labels: {} },
    ]);
    const inspect = vi.fn().mockResolvedValue({
      Config: { Env: ["POSTGRES_DB=app", "POSTGRES_PASSWORD=first=second", "EMPTY=", "MALFORMED", "=ignored"] },
    });
    docker.getContainer.mockReturnValue({ inspect });
    expect(await inspectComposeDatabase("app-123", "db")).toEqual({
      id: "database",
      env: { POSTGRES_DB: "app", POSTGRES_PASSWORD: "first=second", EMPTY: "" },
    });
    expect(docker.listContainers).toHaveBeenCalledWith({
      all: false,
      filters: { label: ["com.docker.compose.project=app-123", "com.docker.compose.service=db"] },
    });
    expect(docker.getContainer).toHaveBeenCalledExactlyOnceWith("database");
    expect(inspect).toHaveBeenCalledOnce();
  });

  it.each([0, 2])("rejects an ambiguous or missing database (%i matching containers)", async (count) => {
    docker.listContainers.mockResolvedValue(Array.from({ length: count }, (_, i) => container(`database-${i}`)));
    await expect(inspectComposeDatabase("app-123", "db")).rejects.toThrow("Expected one running database container");
    expect(docker.getContainer).not.toHaveBeenCalled();
  });
});
