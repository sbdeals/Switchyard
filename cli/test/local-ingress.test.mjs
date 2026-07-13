import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, renderLocalIngress, LOCAL_INGRESS_CONTAINER } from "../dist/lib.js";

test("local ingress is off by default (does not change up's default behavior)", () => {
  assert.equal(defaultConfig("docker-desktop").localIngress, false);
  assert.equal(defaultConfig("linux").localIngress, false);
  assert.equal(defaultConfig("docker-desktop").localIngressHttpPort, 8080);
  assert.equal(defaultConfig("docker-desktop").localIngressHttpsPort, 8443);
});

test("hash is stable for identical config", () => {
  const cfg = defaultConfig("docker-desktop");
  assert.equal(renderLocalIngress(cfg).hash, renderLocalIngress(cfg).hash);
});

test("hash changes when a port changes", () => {
  const cfg = defaultConfig("docker-desktop");
  const base = renderLocalIngress(cfg);
  assert.notEqual(base.hash, renderLocalIngress({ ...cfg, localIngressHttpPort: 9090 }).hash);
  assert.notEqual(base.hash, renderLocalIngress({ ...cfg, localIngressHttpsPort: 9443 }).hash);
});

test("alt ports are published on the container's 80/443", () => {
  const cfg = { ...defaultConfig("docker-desktop"), localIngressHttpPort: 8080, localIngressHttpsPort: 8443 };
  const plan = renderLocalIngress(cfg);
  assert.ok(plan.runArgs.includes("127.0.0.1:8080:80"));
  assert.ok(plan.runArgs.includes("127.0.0.1:8443:443"));
  assert.equal(plan.httpPort, 8080);
  assert.equal(plan.httpsPort, 8443);
});

test("expose switches the bind host (and the hash); default stays on 127.0.0.1", () => {
  const cfg = defaultConfig("docker-desktop");
  const closed = renderLocalIngress(cfg);
  const open = renderLocalIngress({ ...cfg, expose: true });
  assert.equal(closed.bindHost, "127.0.0.1");
  assert.equal(open.bindHost, "0.0.0.0");
  assert.ok(closed.runArgs.includes("127.0.0.1:8080:80"));
  assert.ok(open.runArgs.includes("0.0.0.0:8080:80"));
  assert.notEqual(closed.hash, open.hash);
});

test("run args carry the container name, config-hash label, and traefik configFile", () => {
  const plan = renderLocalIngress(defaultConfig("docker-desktop"));
  assert.ok(plan.runArgs.includes(LOCAL_INGRESS_CONTAINER));
  assert.ok(plan.runArgs.includes(`switchyard.config-hash=${plan.hash}`));
  assert.equal(plan.runArgs.at(-1), "--configFile=/etc/dokploy/traefik/traefik.yml");
});
