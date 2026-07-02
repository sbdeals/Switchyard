import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { nextFreePort, portFree } from "../dist/lib.js";

function occupy() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "0.0.0.0", () => resolve(srv));
  });
}

test("portFree reflects a busy vs free port", async () => {
  const srv = await occupy();
  const port = srv.address().port;
  assert.equal(await portFree(port), false);
  await new Promise((r) => srv.close(r));
  assert.equal(await portFree(port), true);
});

test("nextFreePort skips the busy port", async () => {
  const srv = await occupy();
  const port = srv.address().port;
  try {
    const free = await nextFreePort(port);
    assert.notEqual(free, null);
    assert.ok(free > port);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
