import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../dist/server.js";
import { TOOLS } from "../dist/tools.js";

const EXPECTED = [
  "list_projects",
  "list_services",
  "deploy_image",
  "deploy_repo",
  "deploy_compose",
  "service_action",
  "get_logs",
  "get_metrics",
  "manage_env",
  "manage_domain",
  "create_database",
];

test("TOOLS covers exactly the expected tool set", () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [...EXPECTED].sort());
});

test("every tool has a title, description, and object input schema", () => {
  for (const t of TOOLS) {
    assert.ok(t.title, `${t.name} missing title`);
    assert.ok(t.description && t.description.length > 10, `${t.name} missing description`);
    assert.equal(typeof t.inputSchema, "object", `${t.name} inputSchema not an object`);
  }
});

test("service_action is annotated destructive", () => {
  const sa = TOOLS.find((t) => t.name === "service_action");
  assert.ok(sa?.annotations?.destructiveHint, "service_action should be destructiveHint");
});

test("server constructs and exposes the tool list over MCP", async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...EXPECTED].sort());

  // Each tool should advertise an object JSON schema for its input.
  for (const t of tools) {
    assert.equal(t.inputSchema.type, "object", `${t.name} input schema not object`);
  }

  await client.close();
  await server.close();
});

test("calling a tool without credentials returns a tool error, not a crash", async () => {
  // No DOKPLOY_* env in the test process → the lazy sign-in must fail cleanly
  // and surface as an MCP tool error (isError), proving the guard wrapper works.
  const prevEmail = process.env.DOKPLOY_EMAIL;
  const prevPassword = process.env.DOKPLOY_PASSWORD;
  delete process.env.DOKPLOY_EMAIL;
  delete process.env.DOKPLOY_PASSWORD;
  try {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    const res = await client.callTool({ name: "list_projects", arguments: {} });
    assert.equal(res.isError, true, "expected an error result without credentials");
    assert.match(res.content[0].text, /credential|sign-in|fetch|ECONN|DOKPLOY/i);

    await client.close();
    await server.close();
  } finally {
    if (prevEmail !== undefined) process.env.DOKPLOY_EMAIL = prevEmail;
    if (prevPassword !== undefined) process.env.DOKPLOY_PASSWORD = prevPassword;
  }
});
