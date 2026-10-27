import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const secrets = {
  adminPassword: "SYNTHETIC_ADMIN_PASSWORD",
  sessionSecret: "SYNTHETIC_SESSION_SECRET",
  storePassword: "SYNTHETIC_STORE_PASSWORD",
};

function tempConfig(t, values = secrets) {
  const dir = mkdtempSync(join(tmpdir(), "switchyard-config-redaction-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify({ ...values, dashboardPort: 3101 }), "utf8");
  return file;
}

function runConfig(file, ...args) {
  // Capture both streams in a file so this also works where pipes are restricted.
  const outputFile = `${file}.output`;
  const fd = openSync(outputFile, "w");
  try {
    const result = spawnSync(process.execPath, [cli, "config", ...args], {
      env: { ...process.env, SWITCHYARD_CONFIG: file, NO_COLOR: "1" },
      stdio: ["ignore", fd, fd],
    });
    assert.ifError(result.error);
    const output = stripVTControlCharacters(readFileSync(outputFile, "utf8"));
    assert.equal(result.status, 0, output);
    return output;
  } finally {
    closeSync(fd);
  }
}

test("config list redacts all secrets and leaves ordinary values visible", (t) => {
  const output = runConfig(tempConfig(t), "list");
  for (const [key, value] of Object.entries(secrets)) {
    assert.ok(output.includes(`${key} = ********  (use --show-secrets)`));
    assert.ok(!output.includes(value));
  }
  assert.ok(output.includes("dashboardPort = 3101"));
});

test("config list --show-secrets returns raw secret values", (t) => {
  const output = runConfig(tempConfig(t), "list", "--show-secrets");
  for (const [key, value] of Object.entries(secrets)) {
    assert.ok(output.includes(`${key} = ${value}`));
  }
});

test("config list leaves empty secrets blank", (t) => {
  const emptySecrets = Object.fromEntries(Object.keys(secrets).map((key) => [key, ""]));
  const output = runConfig(tempConfig(t, emptySecrets), "list");
  for (const key of Object.keys(secrets)) {
    assert.ok(output.split("\n").includes(`${key} = `));
  }
});

for (const [key, value] of Object.entries(secrets)) {
  test(`config set ${key} redacts confirmation and persists the raw value`, (t) => {
    const file = tempConfig(t);
    const updated = `${value}_UPDATED`;
    const output = runConfig(file, "set", key, updated, "--no-restart");
    assert.ok(output.includes(`${key} = ******** (saved to ${file})`));
    assert.ok(!output.includes(updated));
    assert.equal(JSON.parse(readFileSync(file, "utf8"))[key], updated);
  });

  test(`config set ${key} --show-secrets returns the raw value`, (t) => {
    const output = runConfig(tempConfig(t), "set", key, value, "--no-restart", "--show-secrets");
    assert.ok(output.includes(`${key} = ${value} (saved to `));
  });

  test(`config get ${key} returns the raw value without --show-secrets`, (t) => {
    assert.equal(runConfig(tempConfig(t), "get", key), `${value}\n`);
  });
}

test("config set leaves ordinary values visible", (t) => {
  const output = runConfig(tempConfig(t), "set", "dashboardPort", "3201", "--no-restart");
  assert.ok(output.includes("dashboardPort = 3201 (saved to "));
});
