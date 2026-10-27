import assert from "node:assert/strict";
import test from "node:test";

import { uploadApplication, UserError } from "../dist/lib.js";

const base = "http://localhost:3000";

test("uploadApplication sends one authenticated multipart ZIP request that triggers the deploy", async (t) => {
  const archive = Uint8Array.from([80, 75, 3, 4]);
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, `${base}/api/application.dropDeployment`);
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, { Origin: base, Cookie: "session=test" });
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get("applicationId"), "app-id");
    assert.equal(init.body.get("dropBuildPath"), "");
    const file = init.body.get("zip");
    assert.equal(file.name, "source.zip");
    assert.equal(file.type, "application/zip");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), archive);
    return new Response("true");
  });

  await uploadApplication(base, "session=test", "app-id", archive);
  assert.equal(fetch.mock.callCount(), 1);
});

test("uploadApplication explains upload limits without hiding an HTTP 413", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("too large", { status: 413 }));
  await assert.rejects(uploadApplication(base, "session=test", "app-id", new Uint8Array()), {
    name: "UserError",
    message: /Upload too large.*\.gitignore or \.dockerignore/,
  });
});

test("uploadApplication distinguishes expired authentication from missing permission", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("Unauthorized", { status: 401 }));
  await assert.rejects(uploadApplication(base, "session=test", "app-id", new Uint8Array()), /Not logged in.*401/);
  fetch.mock.mockImplementation(async () => new Response("Forbidden", { status: 403 }));
  await assert.rejects(uploadApplication(base, "session=test", "app-id", new Uint8Array()), /denied permission.*403/);
});

test("uploadApplication reports failed HTTP responses with bounded detail", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("x".repeat(300), { status: 500 }));
  await assert.rejects(uploadApplication(base, "session=test", "app-id", new Uint8Array()), {
    name: "UserError",
    message: `Dokploy upload failed (500): ${"x".repeat(200)}`,
  });
});

test("uploadApplication reports an unavailable platform", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(uploadApplication(base, "session=test", "app-id", new Uint8Array()), (error) => {
    assert.ok(error instanceof UserError);
    assert.match(error.message, /Cannot upload.*platform is running.*switchyard up/);
    return true;
  });
});

test("uploadApplication does not encourage duplicate deployments after an upload timeout", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  });
  await assert.rejects(uploadApplication(base, "session=test", "app-id", new Uint8Array()), /Upload timed out.*before retrying/);
});
