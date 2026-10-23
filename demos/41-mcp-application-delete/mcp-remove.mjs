// usage: node mcp-remove.mjs <mcp-dir> <service-name>
import { createRequire } from 'module';
import fs from 'fs';
const [dir, name] = process.argv.slice(2);
const req = createRequire(dir + '/package.json');
const { Client } = await import(req.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StdioClientTransport } = await import(req.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
const transport = new StdioClientTransport({ command: 'node', args: [dir + '/dist/index.js'], env: { ...process.env,
  DOKPLOY_URL: 'http://127.0.0.1:3000', DOKPLOY_ORIGIN: 'http://127.0.0.1:3000', DOKPLOY_EMAIL: 'admin@switchyard.local',
  DOKPLOY_PASSWORD: fs.readFileSync('/etc/dokploy-bridge-secrets/admin', 'utf8').trim() }, stderr: 'ignore' });
const client = new Client({ name: 'demo', version: '0' });
await client.connect(transport);
console.log(`$ mcp tools/call service_action {"service":"${name}","action":"remove"}`);
const r = await client.callTool({ name: 'service_action', arguments: { service: name, action: 'remove' } });
console.log(`isError=${!!r.isError}`); console.log(r.content.map(c => c.text).join('\n'));
await client.close();
