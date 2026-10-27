import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test, { mock } from "node:test";

import {
  defaultConfig,
  ensureSwitchyard,
  metricsStoreUrl,
  MIGRATION_INSPECT_FORMAT,
  renderContainer,
  sha256,
  UserError,
} from "../dist/lib.js";

test("ensureSwitchyard rejects invalid replacement ports before any Docker calls", async () => {
  const spawn = mock.method(childProcess, "spawn", () => {
    throw new Error("Unexpected Docker call");
  });
  syncBuiltinESMExports();
  try {
    for (const key of ["dokployPort", "dashboardPort", "localIngressHttpPort", "localIngressHttpsPort"]) {
      for (const value of [0, -1, 65536, "abc", 1.5, NaN, Infinity, null, "3001"]) {
        await assert.rejects(
          ensureSwitchyard({ ...defaultConfig(), [key]: value }, "1.0.0", () => {}),
          (err) => {
            assert.ok(err instanceof UserError);
            assert.ok(err.message.includes(key));
            assert.match(err.message, /integer between 1 and 65535/);
            return true;
          },
        );
      }
    }
    assert.equal(spawn.mock.callCount(), 0);
  } finally {
    spawn.mock.restore();
    syncBuiltinESMExports();
  }
});

test("migration inspect format renders a complete JSON object", () => {
  const inspected = {
    State: { Running: true },
    Mounts: [{ Type: "bind", Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock", RW: true }],
    Config: { Env: ["HOME=/root"], User: "", WorkingDir: "/app" },
  };
  const rendered = MIGRATION_INSPECT_FORMAT.replace(/\{\{json (\.[\w.]+)\}\}/g, (_, field) =>
    JSON.stringify(field.slice(1).split(".").reduce((value, key) => value[key], inspected)),
  );
  assert.deepEqual(JSON.parse(rendered), {
    Running: inspected.State.Running,
    Mounts: inspected.Mounts,
    Config: inspected.Config,
  });
});

test("hash is stable for identical config", () => {
  const a = renderContainer(defaultConfig("linux"), "1.0.0");
  const b = renderContainer(defaultConfig("linux"), "1.0.0");
  assert.equal(a.hash, b.hash);
  // Secret transport (runEnv) must not change the fingerprint; the data volume
  // mount and agent key location intentionally do (one recreate to attach it).
  assert.equal(a.hash, "1d3369f375dc9fe2eb65d53834153d40f876218c9c04de943c3f3f5527d36844");
});

test("hash changes when a container-relevant setting changes", () => {
  const cfg = defaultConfig("linux");
  const base = renderContainer(cfg, "1.0.0");
  assert.notEqual(base.hash, renderContainer({ ...cfg, dashboardPort: 3101 }, "1.0.0").hash);
  assert.notEqual(base.hash, renderContainer({ ...cfg, adminPassword: "pw" }, "1.0.0").hash);
  assert.notEqual(base.hash, renderContainer({ ...cfg, imageTag: "latest" }, "1.0.0").hash);
});

test("imageTag defaults to the CLI version and can be overridden", () => {
  const cfg = defaultConfig("linux");
  assert.equal(renderContainer(cfg, "9.9.9").image, "ghcr.io/sbdeals/switchyard:9.9.9");
  assert.equal(
    renderContainer({ ...cfg, imageTag: "latest" }, "9.9.9").image,
    "ghcr.io/sbdeals/switchyard:latest",
  );
});

test("expose switches the publish binding (and the hash)", () => {
  const cfg = defaultConfig("linux");
  const closed = renderContainer(cfg, "1.0.0");
  const open = renderContainer({ ...cfg, expose: true }, "1.0.0");
  assert.ok(closed.runArgs.includes("127.0.0.1:3001:3001"));
  assert.ok(open.runArgs.includes("0.0.0.0:3001:3001"));
  assert.notEqual(closed.hash, open.hash);
});

test("hostIp adds SWITCHYARD_HOST_IP and changes the hash; empty is a no-op", () => {
  const cfg = defaultConfig("linux");
  const base = renderContainer(cfg, "1.0.0");
  // Empty hostIp (the default) must not add the env or perturb the hash.
  assert.ok(!base.runArgs.some((a) => a.startsWith("SWITCHYARD_HOST_IP=")));
  const withIp = renderContainer({ ...cfg, hostIp: "203.0.113.10" }, "1.0.0");
  assert.ok(withIp.runArgs.includes("SWITCHYARD_HOST_IP=203.0.113.10"));
  assert.notEqual(base.hash, withIp.hash);
});

test("run args carry the BFF env and labels", () => {
  const cfg = { ...defaultConfig("linux"), adminEmail: "a@b.co", adminPassword: "pw" };
  const plan = renderContainer(cfg, "1.0.0");
  assert.ok(plan.runArgs.includes("DOKPLOY_EMAIL=a@b.co"));
  assert.ok(plan.runArgs.includes("DOKPLOY_PASSWORD"));
  assert.equal(plan.runEnv.DOKPLOY_PASSWORD, "pw");
  assert.ok(plan.runArgs.includes("DOKPLOY_URL=http://dokploy:3000"));
  assert.ok(plan.runArgs.includes(`switchyard.config-hash=${plan.hash}`));
  assert.equal(plan.runArgs.at(-1), plan.image);
});

test("dashboard data mount and agent key location are rendered and fingerprinted", () => {
  const plan = renderContainer(defaultConfig("linux"), "1.0.0");
  const values = (flag) => plan.runArgs.flatMap((arg, index) =>
    arg === flag ? [plan.runArgs[index + 1]] : [],
  );
  assert.deepEqual(values("-v"), [
    "/var/run/docker.sock:/var/run/docker.sock",
    "switchyard-data:/app/data",
  ]);
  assert.ok(values("-e").includes("SWITCHYARD_AGENT_KEY_FILE=/app/data/agent-key.json"));

  const env = Object.fromEntries(values("-e").map((entry) => {
    const separator = entry.indexOf("=");
    // Secrets are passed by name only; their values travel in runEnv.
    if (separator === -1) return [entry, plan.runEnv[entry]];
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const spec = {
    image: plan.image,
    network: values("--network")[0],
    publish: values("-p")[0],
    socket: values("-v")[0],
    data: values("-v")[1],
    env,
    restart: values("--restart")[0],
  };
  assert.equal(plan.hash, sha256(JSON.stringify(spec)));
  const { data, ...withoutData } = spec;
  assert.notEqual(plan.hash, sha256(JSON.stringify(withoutData)));
  const withoutKeyLocation = { ...spec, env: { ...env } };
  delete withoutKeyLocation.env.SWITCHYARD_AGENT_KEY_FILE;
  assert.notEqual(plan.hash, sha256(JSON.stringify(withoutKeyLocation)));
});

test("session secret is passed to the dashboard and folds into the hash", () => {
  const cfg = { ...defaultConfig("linux"), sessionSecret: "s3cr3t" };
  const plan = renderContainer(cfg, "1.0.0");
  assert.ok(plan.runArgs.includes("SWITCHYARD_SESSION_SECRET"));
  assert.equal(plan.runEnv.SWITCHYARD_SESSION_SECRET, "s3cr3t");
  // Changing the secret must change the fingerprint so `up` recreates.
  const other = renderContainer({ ...cfg, sessionSecret: "different" }, "1.0.0");
  assert.notEqual(plan.hash, other.hash);
});

test("metrics store URL is wired into the container env and the hash", () => {
  const cfg = defaultConfig("linux");
  // No password yet → empty URL, and the env var is present-but-empty.
  assert.equal(metricsStoreUrl(cfg), "");
  const noStore = renderContainer(cfg, "1.0.0");
  assert.ok(noStore.runArgs.includes("SWITCHYARD_STORE_URL"));
  assert.equal(noStore.runEnv.SWITCHYARD_STORE_URL, "");

  // With a password, the URL points at the store service by DNS and is hashed.
  const withPw = { ...cfg, storePassword: "s3cret" };
  const url = metricsStoreUrl(withPw);
  assert.match(url, /^postgresql:\/\/switchyard:s3cret@switchyard-metrics:5432\/switchyard$/);
  const plan = renderContainer(withPw, "1.0.0");
  assert.ok(plan.runArgs.includes("SWITCHYARD_STORE_URL"));
  assert.equal(plan.runEnv.SWITCHYARD_STORE_URL, url);
  assert.notEqual(noStore.hash, plan.hash);
});

test("disabling the store blanks the URL", () => {
  const cfg = { ...defaultConfig("linux"), store: false, storePassword: "s3cret" };
  assert.equal(metricsStoreUrl(cfg), "");
});
