import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "./tools.js";

export const SERVER_NAME = "switchyard";
export const SERVER_VERSION = "0.1.0";

/**
 * Construct the Switchyard MCP server with every Dokploy tool registered.
 * Building the server does NOT touch Dokploy or Docker — the clients sign in /
 * connect lazily on the first tool call — so this is safe to call in tests.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Drive the Switchyard/Dokploy PaaS: list and deploy services (Docker images, " +
        "Git repos, compose stacks, databases), manage env and domains, and read logs/metrics. " +
        "Discover ids with list_projects and list_services; target logs/metrics by service name.",
    }
  );
  registerTools(server);
  return server;
}
