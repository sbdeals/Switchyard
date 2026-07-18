import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { darwinEngineCandidates, dockerHostUrl, engineFallbackHint } from "../dist/lib.js";

const HOME = "/Users/someone";

test("darwinEngineCandidates: well-known OrbStack and Colima locations", () => {
  const cands = darwinEngineCandidates(HOME);
  assert.deepEqual(
    cands.map((c) => c.name),
    ["OrbStack", "Colima"],
  );

  const orbstack = cands.find((c) => c.name === "OrbStack");
  assert.equal(orbstack.socketPath, join(HOME, ".orbstack", "run", "docker.sock"));
  // OrbStack bundles a docker CLI shim usable when none is on PATH.
  assert.equal(orbstack.cliPath, join(HOME, ".orbstack", "bin", "docker"));

  const colima = cands.find((c) => c.name === "Colima");
  assert.equal(colima.socketPath, join(HOME, ".colima", "default", "docker.sock"));
  // Colima relies on a separately installed docker CLI.
  assert.equal(colima.cliPath, undefined);
});

test("dockerHostUrl: unix socket URL", () => {
  assert.equal(dockerHostUrl("/Users/someone/.colima/default/docker.sock"), "unix:///Users/someone/.colima/default/docker.sock");
});

test("engineFallbackHint: nothing found -> no hint", () => {
  assert.equal(engineFallbackHint([], true), undefined);
  assert.equal(engineFallbackHint([], false), undefined);
});

test("engineFallbackHint: socket without a docker CLI suggests installing one", () => {
  const [, colima] = darwinEngineCandidates(HOME);
  const hint = engineFallbackHint([colima], false);
  assert.match(hint, /Colima/);
  assert.match(hint, /brew install docker/);
  assert.match(hint, new RegExp(colima.socketPath.replaceAll(".", "\\.")));
  // Must not send the user to install Docker Desktop.
  assert.doesNotMatch(hint, /Docker Desktop/);
});

test("engineFallbackHint: dead socket with a CLI suggests starting the engine and DOCKER_HOST", () => {
  const cands = darwinEngineCandidates(HOME);
  const hint = engineFallbackHint(cands, true);
  assert.match(hint, /OrbStack/);
  assert.match(hint, /Colima/);
  assert.match(hint, /colima start/);
  // Precise DOCKER_HOST escape hatch, pointing at the first found socket.
  assert.match(hint, new RegExp(`DOCKER_HOST=${dockerHostUrl(cands[0].socketPath).replaceAll(".", "\\.")}`));
  assert.doesNotMatch(hint, /brew install/);
});
