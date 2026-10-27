import assert from "node:assert/strict";
import * as fs from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { agentKeyMigrationPath, migrateAgentKey } from "../dist/lib.js";

const ok = { code: 0, stdout: "", stderr: "" };
const legacy = (config = {}, mounts = []) => ({ Config: config, Mounts: mounts });
const sourcePath = "/root/.switchyard/agent-key.json";
const key = '{"provider":"test","apiKey":"migration-test-secret"}';

test("legacy root dashboard keys use the old home directory", () => {
  assert.equal(agentKeyMigrationPath(legacy()), sourcePath);
  assert.equal(agentKeyMigrationPath(legacy({ User: "root" })), sourcePath);
  assert.equal(agentKeyMigrationPath(legacy({ User: "0:0" })), sourcePath);
  assert.equal(
    agentKeyMigrationPath(legacy({ Env: ["HOME=/home/dashboard"], User: "1000" })),
    "/home/dashboard/.switchyard/agent-key.json",
  );
});

test("migration honors explicit key paths and resolves relative paths in the container", () => {
  assert.equal(
    agentKeyMigrationPath(legacy({ Env: ["SWITCHYARD_AGENT_KEY_FILE= /custom/key.json "] })),
    "/custom/key.json",
  );
  assert.equal(
    agentKeyMigrationPath(legacy({ Env: ["SWITCHYARD_AGENT_KEY_FILE=keys/agent.json"], WorkingDir: "/srv" })),
    "/srv/keys/agent.json",
  );
  assert.equal(
    agentKeyMigrationPath(legacy({ Env: ["SWITCHYARD_AGENT_KEY_FILE=keys/agent.json"] })),
    "/app/keys/agent.json",
  );
  assert.equal(agentKeyMigrationPath(legacy({ Env: ["SWITCHYARD_AGENT_KEY_FILE=   "] })), sourcePath);
});

test("migration skips only the expected named volume at the dashboard data directory", () => {
  assert.equal(agentKeyMigrationPath(legacy({}, [
    { Type: "volume", Name: "switchyard-data", Destination: "/app/data" },
  ])), null);
  for (const mount of [
    { Type: "bind", Name: "switchyard-data", Destination: "/app/data" },
    { Type: "volume", Name: "other-volume", Destination: "/app/data" },
    { Type: "volume", Name: "switchyard-data", Destination: "/elsewhere" },
  ]) {
    assert.equal(agentKeyMigrationPath(legacy({}, [mount])), sourcePath);
  }
});

test("an unknown non-root home aborts instead of assuming the old key is absent", () => {
  assert.throws(() => agentKeyMigrationPath(legacy({ User: "1000" })), /home|HOME|user/i);
  assert.equal(
    agentKeyMigrationPath(legacy({ User: "1000", Env: ["SWITCHYARD_AGENT_KEY_FILE=/custom/key.json"] })),
    "/custom/key.json",
  );
});

test("migration uses a private temporary copy and stdin, then removes the copy", async () => {
  const calls = [];
  const logs = [];
  let temporaryFile;
  const runDocker = async (args, opts = {}) => {
    calls.push(args);
    assert.ok(args.every((arg) => !arg.includes("migration-test-secret")));
    if (args[0] === "cp") {
      assert.equal(args[1], `switchyard:${sourcePath}`);
      temporaryFile = args[2];
      assert.equal((await lstat(dirname(temporaryFile))).mode & 0o777, 0o700);
      await writeFile(temporaryFile, key);
      await chmod(temporaryFile, 0o644);
    } else {
      assert.equal(args[0], "run");
      assert.ok(args.includes("--rm"));
      assert.ok(args.includes("-i"));
      assert.ok(args.includes("switchyard-data:/app/data"));
      assert.ok(args.includes("test-dashboard:latest"));
      assert.equal(opts.input, key);
      assert.equal((await lstat(temporaryFile)).mode & 0o777, 0o600);
    }
    return { ...ok, stdout: args[0] === "run" ? "migrated" : "" };
  };

  await migrateAgentKey("switchyard", sourcePath, "test-dashboard:latest", (message) => logs.push(message), runDocker);
  assert.equal(calls.length, 2);
  assert.ok(logs.every((message) => !message.includes("migration-test-secret")));
  await assert.rejects(access(dirname(temporaryFile)), { code: "ENOENT" });
});

test("an absent legacy key needs no volume helper and still cleans up", async () => {
  let temporaryFile;
  const calls = [];
  await migrateAgentKey("switchyard", sourcePath, "test-dashboard:latest", () => {}, async (args) => {
    calls.push(args);
    temporaryFile = args[2];
    return { code: 1, stdout: "", stderr: `Error response from daemon: Could not find the file ${sourcePath} in container switchyard` };
  });
  assert.equal(calls.length, 1);
  await assert.rejects(access(dirname(temporaryFile)), { code: "ENOENT" });
});

test("copy errors abort without echoing Docker output or leaving a temporary directory", async () => {
  let temporaryFile;
  const logs = [];
  await assert.rejects(
    migrateAgentKey("switchyard", sourcePath, "test-dashboard:latest", (message) => logs.push(message), async (args) => {
      assert.equal(args[0], "cp");
      temporaryFile = args[2];
      return { code: 1, stdout: key, stderr: `Cannot connect to Docker: ${key}` };
    }),
    (error) => {
      assert.ok(!error.message.includes("migration-test-secret"));
      return true;
    },
  );
  assert.ok(logs.every((message) => !message.includes("migration-test-secret")));
  await assert.rejects(access(dirname(temporaryFile)), { code: "ENOENT" });
});

test("helper failure aborts without exposing the key and cleans up the private copy", async () => {
  let temporaryFile;
  const logs = [];
  await assert.rejects(
    migrateAgentKey("switchyard", sourcePath, "test-dashboard:latest", (message) => logs.push(message), async (args) => {
      if (args[0] === "cp") {
        temporaryFile = args[2];
        await writeFile(temporaryFile, key);
        return ok;
      }
      return { code: 1, stdout: key, stderr: key };
    }),
    (error) => {
      assert.ok(!error.message.includes("migration-test-secret"));
      return true;
    },
  );
  assert.ok(logs.every((message) => !message.includes("migration-test-secret")));
  await assert.rejects(access(dirname(temporaryFile)), { code: "ENOENT" });
});

for (const kind of ["directory", "symlink"]) {
  test(`migration rejects a copied ${kind} before writing to the volume`, async () => {
    let temporaryFile;
    await assert.rejects(
      migrateAgentKey("switchyard", sourcePath, "test-dashboard:latest", () => {}, async (args) => {
        assert.equal(args[0], "cp", "invalid source must not reach the volume helper");
        temporaryFile = args[2];
        if (kind === "directory") await mkdir(temporaryFile);
        else await symlink("/does-not-exist", temporaryFile);
        return ok;
      }),
    );
    await assert.rejects(access(dirname(temporaryFile)), { code: "ENOENT" });
  });
}

test("the import helper publishes private data and retries safely without overwriting conflicts", async () => {
  const volume = await mkdtemp(join(tmpdir(), "switchyard-test-data-"));
  const target = join(volume, "agent-key.json");
  let source = key;
  const runDocker = async (args, opts = {}) => {
    if (args[0] === "cp") {
      await writeFile(args[2], source);
      return ok;
    }
    // Exercise the production helper on a local directory: Docker would mount
    // this directory at /app/data, which is the only substitution made here.
    const script = args[args.indexOf("-e") + 1].replaceAll(
      "/app/data", volume.replaceAll("\\", "\\\\").replaceAll("'", "\\'"),
    );
    let stdout = "";
    const helperProcess = { exitCode: 0, stdout: { write: (chunk) => { stdout += chunk; } } };
    const require = createRequire(import.meta.url);
    runInNewContext(script, {
      process: helperProcess,
      require: (name) => name === "node:fs" ? {
        ...fs,
        readFileSync: (path, ...args) => path === 0 ? Buffer.from(opts.input) : fs.readFileSync(path, ...args),
      } : require(name),
    });
    return { code: helperProcess.exitCode, stdout, stderr: "" };
  };
  try {
    await migrateAgentKey("switchyard", sourcePath, "test-dashboard:latest", () => {}, runDocker);
    assert.equal(await readFile(target, "utf8"), key);
    assert.equal((await lstat(target)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(volume), ["agent-key.json"]);

    await migrateAgentKey("switchyard", sourcePath, "test-dashboard:latest", () => {}, runDocker);
    assert.equal(await readFile(target, "utf8"), key);

    source = '{"provider":"test","apiKey":"newer-legacy-key"}';
    await assert.rejects(
      migrateAgentKey("switchyard", sourcePath, "test-dashboard:latest", () => {}, runDocker),
      /migration failed/i,
    );
    assert.equal(await readFile(target, "utf8"), key);
    assert.deepEqual(await readdir(volume), ["agent-key.json"]);
  } finally {
    await rm(volume, { recursive: true, force: true });
  }
});
