import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DOKPLOY_URL = "http://dokploy.test";
process.env.DOKPLOY_EMAIL = "test@example.test";
process.env.DOKPLOY_PASSWORD = "test-password";

const { TOOLS } = await import("../dist/tools.js");
const fixture = JSON.parse(await readFile(new URL("./fixtures/list-services.json", import.meta.url), "utf8"));

function mockDokploy(t) {
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/api\//, "") + url.search;
    if (path === "auth/sign-in/email") {
      return new Response(null, { headers: { "set-cookie": "session=test-session" } });
    }
    if (path === "project.all") return Response.json(fixture.projects);
    assert.ok(Object.hasOwn(fixture.details, path), `Unexpected request: ${path}`);
    return Response.json(fixture.details[path]);
  });
}

const production = {
  projectId: "project-shop", projectName: "Shop",
  environmentId: "env-production", environmentName: "Production",
};
const staging = { ...production, environmentId: "env-staging", environmentName: "Staging" };

test("list_services returns only metadata for applications, compose, and every database engine", async (t) => {
  mockDokploy(t);
  const result = await TOOLS.find((tool) => tool.name === "list_services").handler({});
  assert.notEqual(result.isError, true);
  const output = result.content[0].text;
  assert.doesNotMatch(JSON.stringify(result), /secret-/);
  assert.doesNotMatch(output, /"(?:env|buildArgs|buildSecrets|password|databasePassword|rootPassword|config|composeFile)"\s*:/);
  assert.deepEqual(JSON.parse(output), [
    { kind: "database", id: "db-mariadb", name: "MariaDB", appName: "shop-mariadb", status: "running", engine: "mariadb", ...staging },
    { kind: "database", id: "db-mongo", name: "Mongo", appName: "shop-mongo", status: "error", engine: "mongo", ...staging },
    { kind: "database", id: "db-mysql", name: "MySQL", appName: "shop-mysql", status: "idle", engine: "mysql", ...production },
    { kind: "database", id: "db-postgres", name: "Postgres", appName: "shop-postgres", status: "running", engine: "postgres", ...production },
    { kind: "database", id: "db-redis", name: "Redis", appName: "shop-redis", status: "running", engine: "redis", ...production },
    { kind: "application", id: "app-web", name: "Web", appName: "shop-web", status: "running", ...production },
    { kind: "compose", id: "compose-worker", name: "Worker", appName: "shop-worker", status: "idle", ...staging },
  ]);
});

test("manage_env reads retain values when resolving a service by name, appName, or id", async (t) => {
  mockDokploy(t);
  const manageEnv = TOOLS.find((tool) => tool.name === "manage_env");
  for (const [path, detail] of Object.entries(fixture.details)) {
    const [type, query] = path.split(".one?");
    const id = new URLSearchParams(query).values().next().value;
    const kind = type === "application" || type === "compose" ? type : "database";
    for (const service of [detail.name, detail.appName, id]) {
      const result = await manageEnv.handler({ service, mode: "read" });
      assert.notEqual(result.isError, true, service);
      assert.deepEqual(JSON.parse(result.content[0].text), {
        service: detail.name, kind, env: detail.env,
      });
    }
  }
});
