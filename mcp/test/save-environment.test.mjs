import assert from "node:assert/strict";
import test from "node:test";

async function mockApplication(t, current, status = 200) {
  const prevEmail = process.env.DOKPLOY_EMAIL;
  const prevPassword = process.env.DOKPLOY_PASSWORD;
  process.env.DOKPLOY_EMAIL = "test@example.com";
  process.env.DOKPLOY_PASSWORD = "test-password";
  let client;
  try {
    client = await import(`../dist/dokploy.js?test=${encodeURIComponent(t.name)}`);
  } finally {
    if (prevEmail === undefined) delete process.env.DOKPLOY_EMAIL;
    else process.env.DOKPLOY_EMAIL = prevEmail;
    if (prevPassword === undefined) delete process.env.DOKPLOY_PASSWORD;
    else process.env.DOKPLOY_PASSWORD = prevPassword;
  }

  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const { pathname, search } = new URL(url);
    if (pathname === "/api/auth/sign-in/email") {
      return new Response("{}", { headers: { "set-cookie": "session=test" } });
    }
    requests.push({
      path: pathname + search,
      method: init.method,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    if (pathname === "/api/application.one") return Response.json(current, { status });
    assert.equal(pathname, "/api/application.saveEnvironment");
    return new Response("{}");
  });
  return { save: client.saveApplicationEnvironment, requests };
}

const existing = {
  buildArgs: "NODE_ENV=production\nPUBLIC_URL=https://example.com",
  buildSecrets: "NPM_TOKEN=existing-token",
  createEnvFile: true,
};

for (const { name, current, settings, expected } of [
  { name: "preserves existing build settings", current: existing, expected: existing },
  {
    name: "applies explicit build edits and preserves omitted settings",
    current: existing,
    settings: { buildArgs: "NODE_ENV=development", buildSecrets: "NPM_TOKEN=new-token" },
    expected: {
      buildArgs: "NODE_ENV=development",
      buildSecrets: "NPM_TOKEN=new-token",
      createEnvFile: true,
    },
  },
  {
    name: "allows explicitly clearing build settings",
    current: existing,
    settings: { buildArgs: "", buildSecrets: "", createEnvFile: false },
    expected: { buildArgs: "", buildSecrets: "", createEnvFile: false },
  },
  {
    name: "normalizes unset build settings for the required save input",
    current: { buildArgs: null, buildSecrets: null },
    expected: { buildArgs: "", buildSecrets: "", createEnvFile: false },
  },
]) {
  test(`saving runtime env ${name}`, async (t) => {
    const { save, requests } = await mockApplication(t, current);
    await save("app-1", "RUNTIME_KEY=new-value", settings);
    assert.deepEqual(requests, [
      { path: "/api/application.one?applicationId=app-1", method: "GET", body: undefined },
      {
        path: "/api/application.saveEnvironment",
        method: "POST",
        body: { applicationId: "app-1", env: "RUNTIME_KEY=new-value", ...expected },
      },
    ]);
  });
}

test("saving runtime env does not write if current build settings cannot be read", async (t) => {
  const { save, requests } = await mockApplication(t, { error: "unavailable" }, 500);
  await assert.rejects(save("app-1", "RUNTIME_KEY=new-value"), /application\.one.*failed \(500\)/);
  assert.deepEqual(requests, [
    { path: "/api/application.one?applicationId=app-1", method: "GET", body: undefined },
  ]);
});
