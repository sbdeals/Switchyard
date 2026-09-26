import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Exercise the actual production route handlers. Run after `npm run build`.
const secret = "switchyard-auth-regression-test";
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
  env: { ...process.env, SWITCHYARD_SESSION_SECRET: secret },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

function token(iat) {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(secret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.from(JSON.stringify({
    dokployCookie: "fixture=fixture", email: "fixture@example.com", iat,
  }));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

try {
  const deadline = Date.now() + 30_000;
  while (true) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch { /* waiting for server */ }
    if (Date.now() > deadline) throw new Error(`Server did not start: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const endpoints = [
    ["GET", "config"], ["GET", "models"], ["GET", "changes"],
    ["POST", "chat"], ["POST", "changes"], ["POST", "config"],
    ["POST", "oauth/start"], ["POST", "oauth/complete"],
  ];
  for (const [method, path] of endpoints) {
    const response = await fetch(`${base}/api/agent/${path}`, {
      method, headers: { cookie: "switchyard_session=forged" },
    });
    assert.equal(response.status, 401, `${method} ${path} must reject a forged cookie`);
  }
  for (const iat of [Date.now() - 8 * 24 * 60 * 60 * 1000, Date.now() + 120_000]) {
    const response = await fetch(`${base}/api/agent/config`, {
      headers: { cookie: `switchyard_session=${token(iat)}` },
    });
    assert.equal(response.status, 401, "Expired or future session must be rejected");
  }
  const valid = await fetch(`${base}/api/agent/config`, {
    headers: { cookie: `switchyard_session=${token(Date.now())}` },
  });
  assert.equal(valid.status, 200, "A valid sealed session must work");
  console.log("Agent session checks passed.");
} finally {
  child.kill();
}
