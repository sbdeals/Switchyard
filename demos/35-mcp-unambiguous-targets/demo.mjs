// node demo.mjs <mcp-dist-dir>  — calls the real MCP tool handlers against the live Dokploy on :3000
const dist = process.argv[2];
const { TOOLS } = await import(dist + '/tools.js');
const tool = (n) => TOOLS.find((t) => t.name === n);
const show = async (label, name, args) => {
  const r = await tool(name).handler(args);
  console.log(`\n$ ${name} ${JSON.stringify(args)}   # ${label}`);
  console.log((r.isError ? '[isError] ' : '') + r.content.map((c) => c.text).join('\n'));
};
await show('two apps are both named "api" (production + staging); showing name/env only', 'list_projects', {});
await show('ambiguous display name', 'manage_env', { service: 'api', mode: 'read' });
await show('explicit appName', 'manage_env', { service: 'api-7dcbbh', mode: 'read' });
