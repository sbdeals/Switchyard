import assert from "node:assert/strict";
import test from "node:test";

import { downControlPlane, planControlPlaneDown } from "../dist/lib.js";

const controlPlane = [
  ...["switchyard", "switchyard-traefik", "dokploy-traefik"].map((name) => ({ kind: "container", name })),
  ...["dokploy", "dokploy-postgres", "dokploy-redis", "switchyard-metrics"].map((name) => ({ kind: "service", name })),
  { kind: "network", name: "dokploy-network" },
  ...["dokploy_postgres_password", "dokploy_auth_secret"].map((name) => ({ kind: "secret", name })),
  ...["dokploy", "dokploy-postgres", "dokploy-redis", "switchyard-metrics"].map((name) => ({ kind: "volume", name })),
];

const workloads = [
  { kind: "container", name: "unlabelled-app", labels: {} },
  { kind: "container", name: "dokploy-user-app", labels: {}, networks: ["dokploy-network"] },
  { kind: "container", name: "compose-db", labels: { "com.docker.compose.project": "my-project" } },
  { kind: "container", name: "switchyard-other", labels: { "switchyard.managed": "true" } },
  { kind: "service", name: "dokploy-user-service" },
  { kind: "volume", name: "dokploy-user-data", labels: {} },
  { kind: "volume", name: "compose-data", labels: { "com.docker.compose.project": "my-project" } },
  { kind: "volume", name: "switchyard-metrics-backup", labels: {} },
  { kind: "network", name: "other-network" },
  { kind: "secret", name: "other-secret" },
];

test("control-plane stop leaves unlabelled containers and all workloads untouched", () => {
  assert.deepEqual(planControlPlaneDown([...controlPlane, ...workloads], false),
    controlPlane.filter(({ kind }) => kind === "container" || kind === "service"));
  assert.deepEqual(planControlPlaneDown(workloads, false), []);
});

test("only reset removes control-plane volumes; user volumes survive even reset in the fallback design", () => {
  const inventory = [...controlPlane, ...workloads];
  assert.ok(planControlPlaneDown(inventory, false).every(({ kind }) => kind !== "volume"));
  assert.deepEqual(planControlPlaneDown(inventory, true), controlPlane);
  assert.deepEqual(planControlPlaneDown(workloads, true), []);
});

test("planner matches both kind and exact reserved name, without duplicates or input mutation", () => {
  const inventory = [
    { kind: "container", name: "dokploy-postgres" },
    { kind: "volume", name: "switchyard" },
    { kind: "volume", name: "dokploy-postgres-old" },
    { kind: "volume", name: "dokploy-postgres" },
    { kind: "volume", name: "dokploy-postgres" },
  ];
  const before = structuredClone(inventory);
  assert.deepEqual(planControlPlaneDown(inventory, true), [{ kind: "volume", name: "dokploy-postgres" }]);
  assert.deepEqual(inventory, before);
});

test("planner re-run after applying stop or reset is a no-op", () => {
  for (const purge of [false, true]) {
    const inventory = [...controlPlane, ...workloads];
    const plan = planControlPlaneDown(inventory, purge);
    const remaining = inventory.filter((item) => !plan.some((action) => action.kind === item.kind && action.name === item.name));
    assert.deepEqual(planControlPlaneDown(remaining, purge), []);
  }
});

function fakeDocker(inventory = [...controlPlane, ...workloads], intercept = () => undefined) {
  const remaining = structuredClone(inventory);
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    const overridden = intercept(args, calls);
    if (overridden) return overridden;
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    if (args[0] === "network" && args[1] === "inspect") return ok("dokploy-network-id");
    if (args[0] === "service" && args[1] === "inspect") return ok();
    if (args[0] === "ps" && args.includes("--filter")) {
      if (args.includes("network=dokploy-network")) {
        return ok(remaining.filter((item) => item.kind === "container" && item.networks?.includes("dokploy-network"))
          .map((item) => `${item.name}\t${item.labels?.["com.docker.swarm.service.name"] || ""}`).join("\n"));
      }
      return ok();
    }
    if (args[0] === "ps" || args[1] === "ls") {
      const kind = args[0] === "ps" ? "container" : args[0];
      return ok(remaining.filter((item) => item.kind === kind).map((item) => item.name).join("\n"));
    }
    assert.ok(args[0] === "rm" || args[1] === "rm", `Unexpected fake command: ${args}`);
    const kind = args[0] === "rm" ? "container" : args[0];
    const index = remaining.findIndex((item) => item.kind === kind && item.name === args.at(-1));
    assert.notEqual(index, -1, `Attempted to remove absent resource: ${args}`);
    remaining.splice(index, 1);
    return ok();
  };
  return { run, remaining, calls };
}

const noWait = async () => {};
const quiet = () => {};
const removals = (calls) => calls.filter((args) => args[0] === "rm" || args[1] === "rm");

test("fake executor stops only the control plane and preserves every volume", async () => {
  const fake = fakeDocker();
  const logs = [];
  await downControlPlane(false, (line) => logs.push(line), fake.run, noWait);
  assert.deepEqual(fake.remaining, [...controlPlane.filter(({ kind }) => kind !== "container" && kind !== "service"), ...workloads]);
  assert.ok(logs.some((line) => /keep running/.test(line)));
  assert.ok(fake.calls.every((args) => args[0] !== "volume"));
  const count = removals(fake.calls).length;
  await downControlPlane(false, quiet, fake.run, noWait);
  assert.equal(removals(fake.calls).length, count);
});

test("fake reset removes control-plane data after services, leaves workloads, and re-runs safely", async () => {
  const fake = fakeDocker();
  const logs = [];
  await downControlPlane(true, (line) => logs.push(line), fake.run, noWait);
  assert.deepEqual(fake.remaining, workloads);
  assert.ok(logs.some((line) => /orphaned/.test(line)));
  const firstVolume = fake.calls.findIndex((args) => args[0] === "volume" && args[1] === "rm");
  const lastService = fake.calls.findLastIndex((args) => args[0] === "service" && args[1] === "rm");
  const drain = fake.calls.findIndex((args) => args[0] === "ps" && args.includes("--filter"));
  assert.ok(lastService < drain && drain < firstVolume);
  const count = removals(fake.calls).length;
  await downControlPlane(true, quiet, fake.run, noWait);
  assert.equal(removals(fake.calls).length, count);
});

test("failed inventory aborts before any removal", async () => {
  const fake = fakeDocker(undefined, (args) => args[0] === "volume"
    ? { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" }
    : undefined);
  await assert.rejects(downControlPlane(true, quiet, fake.run, noWait), /Listing volumes failed/);
  assert.deepEqual(removals(fake.calls), []);
});

test("reset keeps the shared network when workloads are attached", async () => {
  const fake = fakeDocker(undefined, (args) => args[0] === "network" && args[1] === "rm"
    ? { code: 1, stdout: "", stderr: "network has active endpoints" }
    : undefined);
  await downControlPlane(true, quiet, fake.run, noWait);
  assert.deepEqual(fake.remaining, [{ kind: "network", name: "dokploy-network" }, ...workloads]);
});

test("reset waits for control-plane tasks but not user service tasks", async () => {
  let polls = 0;
  const fake = fakeDocker(undefined, (args) => args[0] === "ps" && args.includes("--filter")
    ? { code: 0, stdout: ++polls === 1 ? "dokploy\ndokploy-user-service" : "dokploy-user-service", stderr: "" }
    : undefined);
  let waits = 0;
  await downControlPlane(true, quiet, fake.run, async () => { waits++; });
  assert.equal(waits, 1);
  assert.deepEqual(fake.remaining, workloads);
});

test("failed service removal stops reset before deleting metadata", async () => {
  const fake = fakeDocker(undefined, (args) => args[0] === "service" && args[1] === "rm"
    ? { code: 1, stdout: "", stderr: "permission denied" }
    : undefined);
  await assert.rejects(downControlPlane(true, quiet, fake.run, noWait), /Removing control-plane service/);
  assert.ok(removals(fake.calls).every((args) => args[0] !== "volume" && args[0] !== "secret"));
});

test("failed volume removal is reported instead of claiming a successful reset", async () => {
  const fake = fakeDocker(undefined, (args) => args[0] === "volume" && args[1] === "rm"
    ? { code: 1, stdout: "", stderr: "volume is in use" }
    : undefined);
  await assert.rejects(downControlPlane(true, quiet, fake.run, noWait), /Removing control-plane volume/);
});

test("a task-drain timeout preserves control-plane data", async () => {
  const fake = fakeDocker(undefined, (args) => args[0] === "ps" && args.includes("--filter")
    ? { code: 0, stdout: "dokploy", stderr: "" }
    : undefined);
  await assert.rejects(downControlPlane(true, quiet, fake.run, noWait), /tasks did not stop/);
  assert.ok(removals(fake.calls).every((args) => args[0] !== "volume" && args[0] !== "secret"));
});

test("reset retries active endpoints without assuming that workloads exist", async () => {
  let attempts = 0;
  const fake = fakeDocker(controlPlane, (args) => args[0] === "network" && args[1] === "rm" && ++attempts < 10
    ? { code: 1, stdout: "", stderr: "network has active endpoints" }
    : undefined);
  await downControlPlane(true, quiet, fake.run, noWait);
  assert.equal(attempts, 10);
  assert.deepEqual(fake.remaining, []);
});

test("reset finishes independent removals before reporting all data survivors", async () => {
  const fake = fakeDocker(controlPlane, (args) => args[1] === "rm" && ["dokploy-network", "dokploy"].includes(args.at(-1)) && args[0] !== "service"
    ? { code: 1, stdout: "", stderr: "resource is in use" }
    : undefined);
  await assert.rejects(downControlPlane(true, quiet, fake.run, noWait), /network dokploy-network[\s\S]*volume dokploy/);
  assert.deepEqual(fake.remaining, [
    { kind: "network", name: "dokploy-network" },
    { kind: "volume", name: "dokploy" },
  ]);
});

test("reset waits for leftover tasks even when their service is already absent", async () => {
  let polls = 0;
  const fake = fakeDocker(controlPlane.filter(({ kind }) => kind !== "service"), (args) => args[0] === "ps" && args.includes("--filter")
    ? { code: 0, stdout: ++polls === 1 ? "dokploy" : "", stderr: "" }
    : undefined);
  let waits = 0;
  await downControlPlane(true, quiet, fake.run, async () => { waits++; });
  assert.equal(waits, 1);
  assert.deepEqual(fake.remaining, []);
});
