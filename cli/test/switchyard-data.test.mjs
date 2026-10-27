import assert from "node:assert/strict";
import test from "node:test";

import { removeSwitchyardDataVolume } from "../dist/lib.js";

const ok = { code: 0, stdout: "", stderr: "" };
const absent = { code: 1, stdout: "[]", stderr: "Error response from daemon: get switchyard-data: no such volume" };
const absentDocker27 = { code: 1, stdout: "[]", stderr: "Error response from daemon: volume switchyard-data not found" };

function fakeDocker(responses) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    assert.ok(responses.length > 0, "unexpected Docker command");
    return responses.shift();
  };
  return { calls, run };
}

test("plain down preserves dashboard data without touching its volume", async () => {
  const docker = fakeDocker([]);
  const logs = [];
  await removeSwitchyardDataVolume(false, (message) => logs.push(message), docker.run);
  assert.deepEqual(docker.calls, []);
  assert.deepEqual(logs, []);
});

for (const [engine, missing] of [["older Docker", absent], ["Docker 27", absentDocker27]]) {
  test(`purge removes the dashboard data volume and verifies absence (${engine})`, async () => {
    const docker = fakeDocker([ok, missing]);
    await removeSwitchyardDataVolume(true, () => {}, docker.run);
    assert.deepEqual(docker.calls, [
      ["volume", "rm", "switchyard-data"],
      ["volume", "inspect", "switchyard-data"],
    ]);
  });

  test(`purge tolerates an already absent dashboard data volume (${engine})`, async () => {
    const docker = fakeDocker([missing, missing]);
    await removeSwitchyardDataVolume(true, () => {}, docker.run);
    assert.equal(docker.calls.length, 2);
  });
}

test("purge fails when the dashboard data volume is still in use", async () => {
  const docker = fakeDocker([
    { code: 1, stdout: "", stderr: "volume is in use" },
    { ...ok, stdout: '[{"Name":"switchyard-data"}]' },
  ]);
  await assert.rejects(
    removeSwitchyardDataVolume(true, () => {}, docker.run),
    /Purge incomplete: dashboard data volume switchyard-data still exists/,
  );
});

test("purge verifies absence even when Docker reports removal succeeded", async () => {
  const docker = fakeDocker([ok, { ...ok, stdout: '[{"Name":"switchyard-data"}]' }]);
  await assert.rejects(
    removeSwitchyardDataVolume(true, () => {}, docker.run),
    /switchyard-data still exists/,
  );
});

for (const stderr of [
  "Cannot connect to the Docker daemon",
  "permission denied while trying to connect to the Docker daemon socket",
  "Error response from daemon: volume another-volume not found",
]) {
  test(`purge rejects an inconclusive inspection: ${stderr}`, async () => {
    const docker = fakeDocker([ok, { code: 1, stdout: "", stderr }]);
    await assert.rejects(
      removeSwitchyardDataVolume(true, () => {}, docker.run),
      /Purge incomplete: could not verify removal/,
    );
  });
}
