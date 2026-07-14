#!/usr/bin/env node
/**
 * Switchyard MCP server — stdio entrypoint.
 *
 * Launched by Claude Code (see the repo-root .mcp.json). Talks to Dokploy with
 * its own admin credentials from env (DOKPLOY_URL, DOKPLOY_EMAIL,
 * DOKPLOY_PASSWORD; optional DOKPLOY_ORIGIN, DOCKER_SOCKET). Communicates over
 * stdio only — nothing is bound to a network port.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep stdout clean for the protocol; log to stderr.
  process.stderr.write("[switchyard-mcp] ready (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`[switchyard-mcp] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
