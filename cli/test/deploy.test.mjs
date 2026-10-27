import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { connectDeployClient, createDeployCommand, defaultConfig, deployDirectory } from "../dist/lib.js";

const app = { applicationId: "app/1", name: "web" };
const environment = { environmentId: "env1", name: "production", applications: [app] };
const project = { projectId: "p1", name: "demo", environments: [environment] };
const deployments = "deployment.all?applicationId=app%2F1";
const detail = "application.one?applicationId=app%2F1";

async function fixture(t, filename = "Dockerfile") {
  const path = await mkdtemp(join(tmpdir(), "cli-deploy-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  await writeFile(join(path, filename), filename === "Dockerfile" ? "FROM scratch\n" : "{}\n");
  return path;
}

function clientFor(steps) {
  const remaining = [...steps];
  return {
    async request(path, init = {}) {
      const next = remaining.shift();
      assert.ok(next, `Unexpected request: ${path}`);
      assert.equal(path, next.path);
      assert.equal(init.method ?? "GET", next.method ?? "GET");
      if (next.body) assert.deepEqual(init.body, next.body);
      if (next.error) throw next.error;
      return next.value;
    },
    async upload(id, archive) {
      const next = remaining.shift();
      assert.equal(next?.path, "upload");
      assert.equal(id, app.applicationId);
      assert.equal(Buffer.from(archive).readUInt32LE(0), 0x04034b50);
      if (next.error) throw next.error;
    },
    done() { assert.deepEqual(remaining, []); },
  };
}

function startSteps(previous = [], buildType = "dockerfile") {
  return [
    { path: "project.all", value: [project] },
    { path: deployments, value: previous },
    {
      path: "application.update", method: "POST",
      body: {
        applicationId: app.applicationId, buildType,
        ...(buildType === "dockerfile" ? { dockerfile: "Dockerfile", dockerContextPath: ".", dockerBuildStage: null } : {}),
      },
    },
    { path: "upload" },
  ];
}

const quiet = { log: () => {}, pollIntervalMs: 0, timeoutMs: 1000 };

test("deploy parses default path and all flags without changing up", async () => {
  let parsed;
  const cmd = createDeployCommand(async (path, flags) => { parsed = { path, flags }; });
  await cmd.parseAsync([], { from: "user" });
  assert.deepEqual(parsed, { path: ".", flags: {} });
  const explicit = createDeployCommand(async (path, flags) => { parsed = { path, flags }; });
  await explicit.parseAsync(["./hello", "--service", "web", "--project", "demo", "--detach"], { from: "user" });
  assert.deepEqual(parsed, { path: "./hello", flags: { service: "web", project: "demo", detach: true } });
});

for (const args of [["--service"], ["--project"], ["--unknown"], ["one", "two"]]) {
  test(`deploy rejects invalid arguments: ${args.join(" ")}`, async () => {
    const cmd = createDeployCommand(async () => { assert.fail("Must not deploy"); })
      .exitOverride().configureOutput({ writeErr: () => {} });
    await assert.rejects(cmd.parseAsync(args, { from: "user" }));
  });
}

test("reuse: configure, upload once, ignore old success, track new deploy, print URL", async (t) => {
  const path = await fixture(t);
  const old = { deploymentId: "old", status: "done" };
  const client = clientFor([
    ...startSteps([old]),
    { path: deployments, value: [old] },
    { path: deployments, value: [{ deploymentId: "new", status: "running" }, old] },
    { path: deployments, value: [{ deploymentId: "new", status: "done" }, old] },
    { path: detail, value: { ...app, domains: [{ host: "web.localhost", https: true, path: "/hello" }] } },
  ]);
  const output = [];
  await deployDirectory(path, { service: "web", project: "demo" }, client, { ...quiet, log: (s) => output.push(s) });
  client.done();
  assert.ok(output.includes("Deployment new: running"));
  assert.ok(output.includes("Deployment new: done"));
  assert.ok(output.includes("URL: https://web.localhost/hello"));
});

test("create project and application, default service basename, detach never polls", async (t) => {
  const path = await fixture(t);
  const name = path.split("/").at(-1);
  const client = clientFor([
    { path: "project.all", value: [] },
    { path: "project.create", method: "POST", body: { name: "Default" }, value: { project: { projectId: "p1" }, environment } },
    { path: "project.all", value: [{ ...project, environments: [{ ...environment, applications: [] }] }] },
    { path: "application.create", method: "POST", body: { name, appName: name, environmentId: "env1", sourceType: "drop" }, value: { ...app, name } },
    ...startSteps().slice(1),
    { path: detail, value: app },
  ]);
  const output = [];
  await deployDirectory(path, { detach: true }, client, { ...quiet, log: (s) => output.push(s) });
  client.done();
  assert.ok(output.some((s) => s.includes("No domain configured")));
});

test("explicit missing project creates only that project", async (t) => {
  const path = await fixture(t);
  const client = clientFor([
    { path: "project.all", value: [{ ...project, name: "unrelated" }] },
    { path: "project.create", method: "POST", body: { name: "selected" }, value: { project: { projectId: "p2" } } },
    { path: "project.all", value: [project, { ...project, projectId: "p2", name: "selected" }] },
    ...startSteps().slice(1),
    { path: detail, value: app },
  ]);
  await deployDirectory(path, { service: "web", project: "selected", detach: true }, client, quiet);
  client.done();
});

for (const marker of ["package.json", "requirements.txt", "pyproject.toml", "Pipfile", "go.mod"]) {
  test(`uses Nixpacks when ${marker} exists without a Dockerfile`, async (t) => {
    const path = await fixture(t, marker);
    const client = clientFor([...startSteps([], "nixpacks"), { path: detail, value: app }]);
    await deployDirectory(path, { service: "web", detach: true }, client, quiet);
    client.done();
  });
}

test("no included Dockerfile or buildpack manifest fails before any API mutation", async (t) => {
  const path = await fixture(t);
  await writeFile(join(path, ".gitignore"), "Dockerfile\n");
  const client = clientFor([]);
  await assert.rejects(deployDirectory(path, {}, client, quiet), /No Dockerfile or supported buildpack manifest/);
  client.done();
});

for (const [label, projects, flags, message] of [
  ["multiple projects", [project, { ...project, projectId: "p2", name: "other" }], {}, /--project/],
  ["duplicate project names", [project, { ...project, projectId: "p2" }], { project: "demo" }, /More than one project is named/],
  ["ambiguous environments", [{ ...project, environments: [{ ...environment, name: "dev" }, { ...environment, name: "staging" }] }], {}, /single production environment/],
  ["duplicate application names", [{ ...project, environments: [{ ...environment, applications: [app, app] }] }], { service: "web" }, /More than one application/],
]) {
  test(`rejects ${label} without mutating anything`, async (t) => {
    const path = await fixture(t);
    const client = clientFor([{ path: "project.all", value: projects }]);
    await assert.rejects(deployDirectory(path, flags, client, quiet), message);
    client.done();
  });
}

test("selects production among environments instead of the first environment", async (t) => {
  const path = await fixture(t);
  const steps = startSteps();
  steps[0].value = [{ ...project, environments: [{ environmentId: "dev", name: "dev" }, environment] }];
  const client = clientFor([...steps, { path: detail, value: app }]);
  await deployDirectory(path, { service: "web", detach: true }, client, quiet);
  client.done();
});

test("refuses upload while an earlier deployment is running", async (t) => {
  const path = await fixture(t);
  const client = clientFor(startSteps([{ deploymentId: "old", status: "running" }]).slice(0, 2));
  await assert.rejects(deployDirectory(path, { service: "web" }, client, quiet), /already has a running deployment/);
  client.done();
});

for (const status of ["error", "cancelled"]) {
  test(`reports ${status} from the new deployment`, async (t) => {
    const path = await fixture(t);
    const client = clientFor([...startSteps(), { path: deployments, value: [{ deploymentId: "new", status, errorMessage: "build failed" }] }]);
    await assert.rejects(deployDirectory(path, { service: "web" }, client, quiet), /Deployment new failed.*build failed/);
    client.done();
  });
}

test("never retries an upload with an uncertain result", async (t) => {
  const path = await fixture(t);
  const steps = startSteps();
  steps.at(-1).error = new Error("Upload timed out");
  const client = clientFor(steps);
  await assert.rejects(deployDirectory(path, { service: "web" }, client, quiet), /Upload timed out/);
  client.done();
});

test("times out if only a stale successful deployment is returned", async (t) => {
  const path = await fixture(t);
  const old = { deploymentId: "old", status: "done" };
  const client = clientFor([...startSteps([old]), { path: deployments, value: [old] }]);
  await assert.rejects(deployDirectory(path, { service: "web" }, client, { ...quiet, timeoutMs: 0 }), /Timed out waiting for deployment to start/);
  client.done();
});

test("does not claim another concurrent deployment as its own", async (t) => {
  const path = await fixture(t);
  const client = clientFor([...startSteps(), { path: deployments, value: [
    { deploymentId: "first", status: "done" }, { deploymentId: "second", status: "running" },
  ] }]);
  await assert.rejects(deployDirectory(path, { service: "web" }, client, quiet), /Multiple deployments appeared/);
  client.done();
});

test("missing credentials fails without making requests", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No request expected"));
  await assert.rejects(connectDeployClient(defaultConfig()), /Not logged in/);
});

test("unreachable platform and rejected sign-in have clear errors", async (t) => {
  const cfg = { ...defaultConfig(), adminEmail: "test@example.invalid", adminPassword: "fixture-only" };
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("ECONNREFUSED"); });
  await assert.rejects(connectDeployClient(cfg), /Platform not running/);
  let count = 0;
  mock.mock.mockImplementation(async () => new Response("", { status: count++ === 0 ? 200 : 401 }));
  await assert.rejects(connectDeployClient(cfg), /Not logged in/);
});

test("client reuses configured local auth and reports expired session", async (t) => {
  const cfg = { ...defaultConfig(), dokployPort: 3007, adminEmail: "test@example.invalid", adminPassword: "fixture-only" };
  let count = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.ok(url.startsWith("http://localhost:3007"));
    if (count++ === 0) return new Response("");
    if (url.endsWith("/sign-in/email")) {
      assert.equal(init.headers.Origin, "http://localhost:3007");
      assert.deepEqual(JSON.parse(init.body), { email: cfg.adminEmail, password: cfg.adminPassword });
      return new Response("{}", { headers: { "set-cookie": "session=fixture; HttpOnly" } });
    }
    assert.equal(init.headers.Cookie, "session=fixture");
    return new Response("unauthorized", { status: 401 });
  });
  const client = await connectDeployClient(cfg);
  await assert.rejects(client.request("project.all"), /session expired/);
});
