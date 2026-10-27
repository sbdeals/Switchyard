import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";

import { defaultConfig, dockerDesktopPlatform, ensureSwitchyard, metricsStoreUrl, renderContainer } from "../dist/lib.js";

const secrets = {
  adminPassword: "SYNTH-admin-pw-123 ' \" $(`literal`)\nend",
  sessionSecret: "SYNTH-session-secret-456",
  storePassword: "SYNTH-store-pw-789 ' \" $(`literal`)\r\nend\n",
};

function assertNoSecrets(args) {
  for (const value of [...Object.values(secrets), encodeURIComponent(secrets.storePassword)]) {
    assert.ok(args.every((arg) => !arg.includes(value)), "argv contains a secret");
  }
}

function fakeDocker(t, failCreate = false) {
  const dir = mkdtempSync(join(tmpdir(), "switchyard-argv-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const capture = join(dir, "calls.jsonl");
  writeFileSync(join(dir, "docker"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const env = Object.fromEntries(["DOKPLOY_PASSWORD", "SWITCHYARD_SESSION_SECRET", "SWITCHYARD_STORE_URL", "POSTGRES_PASSWORD"].map(k => [k, process.env[k]]));
const fileIndex = args.indexOf("--env-file");
const envFile = fileIndex < 0 ? undefined : args[fileIndex + 1];
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, env, envFile,
  contents: envFile && fs.readFileSync(envFile, "utf8"),
  mode: envFile && (fs.statSync(envFile).mode & 0o777) }) + "\\n", { mode: 0o600 });
if (args[0] === "inspect") process.exit(1);
if (args[0] === "info") fs.writeSync(1, "active\\n");
if (args[0] === "service" && args[1] === "inspect" && args[2] === "switchyard-metrics") process.exit(1);
if (args[0] === "service" && args[1] === "create") process.exit(${failCreate ? 1 : 0});
if (args[0] === "service" && args[1] === "ls") {
  if (args.at(-1) === "json") {
    for (const Name of ["dokploy", "dokploy-postgres", "dokploy-redis", "switchyard-metrics"]) fs.writeSync(1, JSON.stringify({ Name, Replicas: "1/1" }) + "\\n");
  } else fs.writeSync(1, "1/1\\n");
}
`, { mode: 0o700 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; });
  return { dir, calls: () => readFileSync(capture, "utf8").trim().split("\n").map(JSON.parse) };
}

test("dashboard argv excludes secrets and secret changes still change its fingerprint", () => {
  const cfg = { ...defaultConfig("linux"), ...secrets };
  const plan = renderContainer(cfg, "1.0.0");
  assertNoSecrets(plan.runArgs);
  assert.deepEqual(plan.runEnv, {
    DOKPLOY_PASSWORD: secrets.adminPassword,
    SWITCHYARD_SESSION_SECRET: secrets.sessionSecret,
    SWITCHYARD_STORE_URL: metricsStoreUrl(cfg),
  });
  for (const key of Object.keys(secrets)) {
    assert.notEqual(plan.hash, renderContainer({ ...cfg, [key]: `${cfg[key]}-rotated` }, "1.0.0").hash);
  }
});

test("ensureSwitchyard supplies byte-identical secrets to the Docker child environment", { skip: process.platform === "win32" }, async (t) => {
  const fake = fakeDocker(t);
  const cfg = { ...defaultConfig("linux"), ...secrets };
  assert.equal(await ensureSwitchyard(cfg, "1.0.0", () => {}), "created");
  const calls = fake.calls();
  calls.forEach(({ args }) => assertNoSecrets(args));
  const child = calls.find(({ args }) => args[0] === "run");
  for (const [key, value] of Object.entries(renderContainer(cfg, "1.0.0").runEnv)) {
    assert.equal(child.env[key], value);
    assert.ok(child.args.includes(key));
  }
});

for (const failCreate of [false, true]) {
  test(`Docker Desktop metrics env file preserves the password and is removed after ${failCreate ? "failure" : "success"}`, { skip: process.platform === "win32" }, async (t) => {
    const fake = fakeDocker(t, failCreate);
    const cfg = { ...defaultConfig("docker-desktop"), ...secrets };
    const provision = dockerDesktopPlatform.ensureDokploy(cfg, { force: false }, () => {});
    if (failCreate) await assert.rejects(provision, /Creating switchyard-metrics failed/);
    else await provision;
    const calls = fake.calls();
    calls.forEach(({ args }) => assertNoSecrets(args));
    const child = calls.find(({ args }) => args[0] === "service" && args[1] === "create");
    assert.equal(child.contents, "POSTGRES_PASSWORD\n");
    assert.equal(child.mode, 0o600);
    assert.equal(child.env.POSTGRES_PASSWORD, secrets.storePassword);
    assert.ok(child.args.includes("type=volume,source=switchyard-metrics,target=/var/lib/postgresql/data"));
    assert.equal(existsSync(dirname(child.envFile)), false);
  });

  test(`store shell script accepts exported secrets and removes its env file after ${failCreate ? "failure" : "success"}`, { skip: process.platform === "win32" }, (t) => {
    const fake = fakeDocker(t, failCreate);
    // Only the store launcher is under test; stub host setup so no daemon or
    // root-owned configuration can be touched even when tests run as root.
    copyFileSync(new URL("../../scripts/switchyard-store-up.sh", import.meta.url), join(fake.dir, "switchyard-store-up.sh"));
    writeFileSync(join(fake.dir, "lib.sh"), [
      "require_root() { :; }", "ensure_docker() { :; }", "service_exists() { return 1; }",
      "wait_service_converged() { return 0; }", "log() { :; }", "ok() { :; }",
      "warn() { :; }", "die() { exit 1; }", "",
    ].join("\n"));
    const result = spawnSync("bash", [join(fake.dir, "switchyard-store-up.sh")], {
      env: { ...process.env, SWITCHYARD_METRICS_PASSWORD: secrets.storePassword }, encoding: "utf8",
    });
    assert.equal(result.status, failCreate ? 1 : 0, result.stderr);
    const calls = fake.calls();
    calls.forEach(({ args }) => assertNoSecrets(args));
    const child = calls.find(({ args }) => args[0] === "service" && args[1] === "create");
    assert.equal(child.contents, "POSTGRES_PASSWORD\n");
    assert.equal(child.mode, 0o600);
    assert.equal(child.env.POSTGRES_PASSWORD, secrets.storePassword);
    assert.ok(child.args.includes("type=volume,source=switchyard-metrics,target=/var/lib/postgresql/data"));
    assert.equal(existsSync(child.envFile), false);
  });
}
