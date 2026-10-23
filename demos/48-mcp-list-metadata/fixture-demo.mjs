import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Usage: node /tmp/mcp-list-metadata-demo.mjs /path/to/mcp/dist");

process.env.DOKPLOY_URL = "http://dokploy.test";
process.env.DOKPLOY_EMAIL = "test@example.test";
process.env.DOKPLOY_PASSWORD = "test-password";

const fixture = JSON.parse(await readFile("/workspace/wt-mcp-list-metadata/mcp/test/fixtures/list-services.json", "utf8"));
globalThis.fetch = async (input) => {
  const url = new URL(input);
  const path = url.pathname.replace(/^\/api\//, "") + url.search;
  if (path === "auth/sign-in/email") {
    return new Response(null, { headers: { "set-cookie": "session=test-session" } });
  }
  if (path === "project.all") return Response.json(fixture.projects);
  if (!Object.hasOwn(fixture.details, path)) throw new Error(`Unexpected request: ${path}`);
  return Response.json(fixture.details[path]);
};

const { TOOLS } = await import(pathToFileURL(resolve(process.argv[2], "tools.js")).href);
const result = await TOOLS.find((tool) => tool.name === "list_services").handler({});
if (result.isError) throw new Error(result.content[0].text);
console.log(result.content[0].text);
