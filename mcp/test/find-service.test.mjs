import assert from "node:assert/strict";
import test from "node:test";

// Credentials are captured at import; node:test runs this file in its own process.
process.env.DOKPLOY_EMAIL = "test@example.com";
process.env.DOKPLOY_PASSWORD = "test-password";
const { findService } = await import("../dist/dokploy.js");
const { TOOLS } = await import("../dist/tools.js");

const SERVICES = [
  {
    id: "api-production-id",
    name: "api",
    appName: "api-production",
    projectId: "project-one",
    projectName: "Project One",
    environmentId: "env-production",
    environmentName: "Production",
  },
  {
    id: "api-staging-id",
    name: "api",
    appName: "api-staging",
    projectId: "project-two",
    projectName: "Project Two",
    environmentId: "env-staging",
    environmentName: "Staging",
  },
];

function mockServices(t, services = SERVICES) {
  const mutations = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/auth/sign-in/email") {
      return Response.json({}, { headers: { "set-cookie": "session=test" } });
    }
    if (init?.method === "POST") {
      mutations.push(pathname);
      return Response.json({});
    }
    if (pathname === "/api/project.all") {
      return Response.json(services.map((s) => ({
        projectId: s.projectId,
        name: s.projectName,
        environments: [{
          environmentId: s.environmentId,
          name: s.environmentName,
          applications: [{ applicationId: s.id }],
        }],
      })));
    }
    if (pathname === "/api/application.one") {
      const service = services.find((s) => s.id === searchParams.get("applicationId"));
      assert.ok(service, `Unknown application: ${url}`);
      return Response.json({ name: service.name, appName: service.appName });
    }
    assert.fail(`Unexpected request: ${url}`);
  });
  return mutations;
}

test("findService resolves a unique exact name before substring matches", async (t) => {
  mockServices(t, [SERVICES[0], { ...SERVICES[1], name: "api-worker" }]);
  const service = await findService(" API ");
  assert.equal(service.id, SERVICES[0].id);
});

test("findService rejects duplicate display names with scoped candidates", async (t) => {
  mockServices(t);
  await assert.rejects(findService("api"), (error) => {
    assert.match(error.message, /matches multiple services/);
    for (const s of SERVICES) {
      assert.ok(error.message.includes(
        `${s.name} (project: ${s.projectName}, environment: ${s.environmentName}, id: ${s.id}, appName: ${s.appName})`
      ));
    }
    assert.match(error.message, /Pass the id or appName/);
    return true;
  });
});

test("findService prefers an exact id over appName and duplicate display names", async (t) => {
  mockServices(t, [{ ...SERVICES[0], appName: "api" }, { ...SERVICES[1], id: "api" }]);
  const service = await findService("api");
  assert.equal(service.id, "api");
  assert.equal(service.projectId, SERVICES[1].projectId);
});

test("findService prefers an exact appName over duplicate display names", async (t) => {
  mockServices(t, [SERVICES[0], { ...SERVICES[1], appName: "api" }]);
  const service = await findService(" API ");
  assert.equal(service.id, SERVICES[1].id);
});

for (const [name, args] of [
  ["service_action", { action: "stop" }],
  ["service_action", { action: "remove" }],
  ["manage_env", { mode: "replace", env: "KEY=value" }],
  ["manage_domain", { host: "api.example.com" }],
]) {
  test(`${name} ${args.action ?? args.mode ?? "add"} rejects duplicate names before mutation`, async (t) => {
    const mutations = mockServices(t);
    const tool = TOOLS.find((tool) => tool.name === name);
    const result = await tool.handler({ service: "api", ...args });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /matches multiple services/);
    assert.deepEqual(mutations, []);
  });
}
