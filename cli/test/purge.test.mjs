import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, cpSync, chmodSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const script = fileURLToPath(new URL("../../scripts/dokploy-down.sh", import.meta.url));
const fakeDocker = fileURLToPath(new URL("./fixtures/purge-docker", import.meta.url));
const credentials = {
  adminEmail: "admin@example.test",
  adminPassword: "synthetic-admin-password",
  storePassword: "synthetic-store-password",
};

function fixture(t, platform, failures = {}, extraState = {}) {
  const dir = mkdtempSync(join(tmpdir(), "switchyard-purge-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Linux's script finder repairs executable bits, so run against isolated copies.
  const localCli = join(dir, "cli", "dist", "cli.js");
  cpSync(dirname(cli), dirname(localCli), { recursive: true });
  writeFileSync(join(dir, "cli", "package.json"), '{"type":"module"}\n');
  const scripts = join(dir, "scripts");
  mkdirSync(scripts);
  for (const name of ["dokploy-down.sh", "dokploy-up.sh", "lib.sh"]) {
    copyFileSync(join(dirname(script), name), join(scripts, name));
  }
  const bin = join(dir, "bin");
  mkdirSync(bin);
  copyFileSync(fakeDocker, join(bin, "docker"));
  chmodSync(join(bin, "docker"), 0o755);
  for (const [name, body] of Object.entries({
    id: "printf '0\\n'",
    sudo: 'exec "$@"',
    sleep: ":",
  })) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  // Accelerate retry timers only in the child under test, without production knobs.
  const timerShim = join(dir, "timers.mjs");
  writeFileSync(timerShim, "const original = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...args) => original(fn, Math.min(ms, 1), ...args);\n");
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, platform, ...credentials }));
  const statePath = join(dir, "docker.json");
  writeFileSync(statePath, JSON.stringify({
    resources: {
      network: ["dokploy-network"],
      secret: ["dokploy_postgres_password", "dokploy_auth_secret"],
      volume: ["dokploy", "dokploy-postgres", "dokploy-redis", "switchyard-metrics"],
    },
    failures,
    attempts: {},
    calls: [],
    ...extraState,
  }));
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    SWITCHYARD_CONFIG: configPath,
    PURGE_FAKE_STATE: statePath,
    NODE_OPTIONS: `--import=${timerShim}`,
    NO_COLOR: "1",
  };
  function run(command, args) {
    const log = join(dir, "output.log");
    const fd = openSync(log, "w");
    try {
      const result = spawnSync(command, args, { env, stdio: ["ignore", fd, fd], timeout: 30_000 });
      return { ...result, stdout: readFileSync(log, "utf8"), stderr: "" };
    } finally {
      closeSync(fd);
    }
  }
  return {
    run: () => run(process.execPath, [localCli, "down", "--purge", "--yes"]),
    runScript: (purge = true) => run("bash", [join(scripts, "dokploy-down.sh"), ...(purge ? ["--purge"] : [])]),
    config: () => JSON.parse(readFileSync(configPath, "utf8")),
    state: () => JSON.parse(readFileSync(statePath, "utf8")),
  };
}

function output(result) {
  assert.ifError(result.error);
  return result.stdout + result.stderr;
}

// The fake executable shims use /bin/sh; both CLI platform paths run on Unix.
const unix = { skip: process.platform === "win32" };
// #81 deliberately replaces "fresh slate" with control-plane-only success:
// deployed workloads survive. Keep #51's retry, survivor, and credential checks.
for (const platform of ["linux", "docker-desktop"]) {
  test(`${platform}: in-use volumes fail purge and retain their credentials`, unix, (t) => {
    const f = fixture(t, platform, { "volume/dokploy-postgres": -1, "volume/switchyard-metrics": -1 });
    const result = f.run();
    const text = output(result);
    assert.equal(result.status, 1, text);
    assert.doesNotMatch(text, /Control plane removed/);
    assert.match(text, /dokploy-postgres/);
    assert.match(text, /switchyard-metrics/);
    assert.match(text, /(?:retry|re-run).*down --purge/is);
    for (const key of Object.keys(credentials)) assert.equal(f.config()[key], credentials[key]);
  });

  test(`${platform}: partial purge clears only the removed metrics store's password`, unix, (t) => {
    const f = fixture(t, platform, { "volume/dokploy": -1 });
    const result = f.run();
    assert.equal(result.status, 1, output(result));
    assert.doesNotMatch(output(result), /Control plane removed/);
    assert.equal(f.config().adminEmail, credentials.adminEmail);
    assert.equal(f.config().adminPassword, credentials.adminPassword);
    assert.equal(f.config().storePassword, "");
    assert.deepEqual(f.state().resources.volume, ["dokploy"]);
  });

  test(`${platform}: successful purge retries in-use resources and is idempotent`, unix, (t) => {
    const f = fixture(t, platform, { "network/dokploy-network": 9, "volume/dokploy": 2 });
    const first = f.run();
    assert.equal(first.status, 0, output(first));
    assert.match(output(first), /Control plane removed/);
    for (const key of Object.keys(credentials)) assert.equal(f.config()[key], "");
    assert.equal(f.state().attempts["volume/dokploy"], 3);
    assert.equal(f.state().attempts["network/dokploy-network"], 10);
    const second = f.run();
    assert.equal(second.status, 0, output(second));
    assert.match(output(second), /Control plane removed/);
  });

  test(`${platform}: failed volume verification keeps credentials`, unix, (t) => {
    const f = fixture(t, platform, {}, { listFailure: "volume" });
    const result = f.run();
    assert.equal(result.status, 1, output(result));
    for (const key of Object.keys(credentials)) assert.equal(f.config()[key], credentials[key]);
  });

  test(`${platform}: network/secret survivors fail purge even after all data is removed`, unix, (t) => {
    const f = fixture(t, platform, { "network/dokploy-network": -1, "secret/dokploy_auth_secret": -1 });
    const result = f.run();
    const text = output(result);
    assert.equal(result.status, 1, text);
    assert.match(text, /dokploy-network/);
    assert.match(text, /dokploy_auth_secret/);
    assert.doesNotMatch(text, /Control plane removed/);
    for (const key of Object.keys(credentials)) assert.equal(f.config()[key], "");
  });

  for (const [description, attachments] of [
    ["local containers", { containerAttachments: [{ name: "dokploy-user-app" }] }],
    ["remote Swarm services", { serviceAttachments: { "dokploy-user-service": ["dokploy-network-id"] } }],
  ]) {
    test(`${platform}: purge preserves the shared network for ${description} and is idempotent`, unix, (t) => {
      const f = fixture(t, platform, { "network/dokploy-network": -1 }, attachments);
      for (let run = 0; run < 2; run++) {
        const result = f.run();
        assert.equal(result.status, 0, output(result));
        assert.match(output(result), /Control plane removed/);
        assert.deepEqual(f.state().resources, { network: ["dokploy-network"], secret: [], volume: [] });
        for (const key of Object.keys(credentials)) assert.equal(f.config()[key], "");
        for (const [key, value] of Object.entries(attachments)) assert.deepEqual(f.state()[key], value);
        assert.ok(f.state().calls.filter((args) => args[0] === "rm" || args[1] === "rm")
          .every((args) => !args.some((arg) => /dokploy-user/.test(arg))));
      }
    });
  }

  for (const [description, extraState] of [
    ["unknown attachments", { attachmentFailure: true }],
    ["control-plane task endpoints", { containerAttachments: [{ name: "dokploy.1.task", service: "dokploy" }] }],
    ["control-plane ingress endpoints", { containerAttachments: [{ name: "switchyard-traefik" }] }],
    ["unrelated workload services", { serviceAttachments: { "user-app": ["other-network-id"] } }],
    ["unverified service attachments", { serviceAttachments: { "user-app": ["dokploy-network-id"] }, serviceInspectFailure: true }],
  ]) {
    test(`${platform}: ${description} cannot excuse a surviving network`, unix, (t) => {
      const f = fixture(t, platform, { "network/dokploy-network": -1 }, extraState);
      const result = f.run();
      assert.equal(result.status, 1, output(result));
      assert.match(output(result), /dokploy-network/);
      assert.doesNotMatch(output(result), /Control plane removed/);
      assert.deepEqual(f.state().resources.volume, []);
      for (const key of Object.keys(credentials)) assert.equal(f.config()[key], "");
    });
  }

  test(`${platform}: a workload network does not excuse surviving secrets or data`, unix, (t) => {
    const f = fixture(t, platform, {
      "network/dokploy-network": -1,
      "secret/dokploy_auth_secret": -1,
      "volume/dokploy-postgres": -1,
    }, { containerAttachments: [{ name: "user-app" }] });
    const result = f.run();
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /dokploy_auth_secret/);
    assert.match(output(result), /dokploy-postgres/);
    assert.equal(f.config().adminPassword, credentials.adminPassword);
    assert.equal(f.config().adminEmail, credentials.adminEmail);
    assert.equal(f.config().storePassword, "");
  });
}

test("shell purge waits for service/container drain before removing resources", unix, (t) => {
  const f = fixture(t, "linux", { "network/dokploy-network": 1 }, { servicePolls: 1, containerPolls: 2 });
  const result = f.runScript();
  assert.equal(result.status, 0, output(result));
  const { calls, attempts, resources } = f.state();
  const firstRemoval = calls.findIndex(([kind, action]) => ["network", "secret", "volume"].includes(kind) && action === "rm");
  const beforeRemoval = calls.slice(0, firstRemoval);
  assert.ok(beforeRemoval.some(([kind, action]) => kind === "service" && action === "ls"));
  assert.ok(beforeRemoval.filter(([kind]) => kind === "ps").length >= 3);
  assert.ok(beforeRemoval.filter(([kind]) => kind === "ps").every((args) => args.includes("-a") || args.includes("--all")));
  assert.equal(attempts["network/dokploy-network"], 2);
  assert.ok(Object.values(resources).every((names) => names.length === 0));
});

test("shell stop without purge leaves all resources alone", unix, (t) => {
  const f = fixture(t, "linux");
  const result = f.runScript(false);
  assert.equal(result.status, 0, output(result));
  assert.deepEqual(f.state().attempts, {});
  assert.equal(f.state().resources.volume.length, 4);
});
