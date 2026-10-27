import assert from "node:assert/strict";
import test from "node:test";

const CASES = [
  [{ kind: "application" }, "applicationId", [
    "application.deploy", "application.start", "application.stop", "application.delete",
  ]],
  [{ kind: "compose" }, "composeId", [
    "compose.deploy", "compose.start", "compose.stop", "compose.delete",
  ]],
  [{ kind: "database", engine: "postgres" }, "postgresId", [
    "postgres.deploy", "postgres.start", "postgres.stop", "postgres.remove",
  ]],
  [{ kind: "database", engine: "mysql" }, "mysqlId", [
    "mysql.deploy", "mysql.start", "mysql.stop", "mysql.remove",
  ]],
  [{ kind: "database", engine: "mariadb" }, "mariadbId", [
    "mariadb.deploy", "mariadb.start", "mariadb.stop", "mariadb.remove",
  ]],
  [{ kind: "database", engine: "mongo" }, "mongoId", [
    "mongo.deploy", "mongo.start", "mongo.stop", "mongo.remove",
  ]],
  [{ kind: "database", engine: "redis" }, "redisId", [
    "redis.deploy", "redis.start", "redis.stop", "redis.remove",
  ]],
];
const ACTIONS = ["deploy", "start", "stop", "remove"];

test("service lifecycle requests match the dashboard mappings", async (t) => {
  const env = {
    DOKPLOY_URL: "http://dokploy.test",
    DOKPLOY_EMAIL: "test@example.com",
    DOKPLOY_PASSWORD: "test-password",
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);

  try {
    let requests = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (url === `${env.DOKPLOY_URL}/api/auth/sign-in/email`) {
        return new Response("{}", { headers: { "set-cookie": "session=test-session" } });
      }
      requests.push({ url, method: init.method, body: JSON.parse(init.body) });
      return new Response("{}");
    });
    const { serviceAction } = await import("../dist/dokploy.js");

    for (const [service, idKey, endpoints] of CASES) {
      for (const [index, action] of ACTIONS.entries()) {
        await t.test(`${service.engine ?? service.kind} ${action}`, async () => {
          requests = [];
          const id = `${service.engine ?? service.kind}-test-id`;
          await serviceAction({ ...service, id }, action);
          assert.deepEqual(requests, [{
            url: `${env.DOKPLOY_URL}/api/${endpoints[index]}`,
            method: "POST",
            body: { [idKey]: id },
          }]);
        });
      }
    }
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
