import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defaultConfig } from "../dist/lib.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const PORT_KEYS = ["dokployPort", "dashboardPort", "localIngressHttpPort", "localIngressHttpsPort"];

function withCli(fn) {
  const dir = mkdtempSync(join(tmpdir(), "switchyard-cli-config-test-"));
  const file = join(dir, "config.json");
  const calls = join(dir, "subprocess-calls");
  // Stub subprocesses in the CLI itself: a regression must never reach Docker.
  const stub = `
    import childProcess from "node:child_process";
    import { writeFileSync } from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    childProcess.spawn = () => {
      writeFileSync(${JSON.stringify(calls)}, "called");
      throw new Error("Unexpected subprocess during config validation");
    };
    syncBuiltinESMExports();
  `;
  const preload = `data:text/javascript,${encodeURIComponent(stub)}`;
  const run = (args) => {
    const result = spawnSync(process.execPath, ["--import", preload, CLI, ...args], {
      env: { ...process.env, SWITCHYARD_CONFIG: file, NO_COLOR: "1" },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(existsSync(calls), false, "invalid config must fail before any Docker calls");
    return result;
  };
  try {
    fn(file, dir, run);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const key of PORT_KEYS) {
  test(`config set rejects invalid ${key} without persisting or calling Docker`, () => {
    withCli((file, dir, run) => {
      for (const existed of [false, true]) {
        const original = JSON.stringify(defaultConfig(), null, 2) + "\n";
        if (existed) writeFileSync(file, original, "utf8");
        for (const value of ["0", "-1", "65536", "abc", "1.5"]) {
          const result = run(["config", "set", key, "--", value]);
          assert.equal(result.status, 1);
          assert.ok(result.stderr.includes(key), result.stderr);
          assert.match(result.stderr, /integer between 1 and 65535/);
          assert.equal(existsSync(file), existed);
          if (existed) assert.equal(readFileSync(file, "utf8"), original);
          assert.deepEqual(readdirSync(dir), existed ? ["config.json"] : []);
        }
      }
    });
  });

  test(`bad persisted ${key} blocks up and config set before Docker`, () => {
    withCli((file, dir, run) => {
      for (const value of [0, -1, 65536, "abc"]) {
        const original = JSON.stringify({ ...defaultConfig(), [key]: value });
        writeFileSync(file, original, "utf8");
        for (const args of [["up", "--headless"], ["config", "set", "dashboardPort", "3101"]]) {
          const result = run(args);
          assert.equal(result.status, 1);
          assert.ok(result.stderr.includes(key), result.stderr);
          assert.ok(result.stderr.includes(file), result.stderr);
          assert.equal(readFileSync(file, "utf8"), original);
          assert.deepEqual(readdirSync(dir), ["config.json"]);
        }
      }
    });
  });
}

test("config set persists valid port boundaries with --no-restart", () => {
  withCli((file, dir, run) => {
    const config = defaultConfig();
    for (const key of PORT_KEYS) {
      for (const value of [1, 65535]) {
        const result = run(["config", "set", key, String(value), "--no-restart"]);
        assert.equal(result.status, 0, result.stderr);
        config[key] = value;
        assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), config);
        assert.deepEqual(readdirSync(dir), ["config.json"]);
      }
    }
  });
});
