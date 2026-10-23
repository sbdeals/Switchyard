// Call the BUILT list_services handler against the live bridge Dokploy and summarize what it returns.
// usage: node live-demo.mjs <mcp dist dir>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
process.env.DOKPLOY_URL = 'http://127.0.0.1:3000';
process.env.DOKPLOY_EMAIL = 'admin@switchyard.local';
process.env.DOKPLOY_PASSWORD = readFileSync('/etc/dokploy-bridge-secrets/admin', 'utf8').trim();
const { TOOLS } = await import(pathToFileURL(resolve(process.argv[2], 'tools.js')).href);
const res = await TOOLS.find((t) => t.name === 'list_services').handler({});
const out = res.content[0].text;
const svcs = JSON.parse(out);
const keys = new Set(svcs.flatMap((s) => Object.keys(s)));
const withEnv = svcs.filter((s) => typeof s.env === 'string' && s.env.trim());
console.log(`services: ${svcs.length}   response bytes: ${out.length}`);
console.log(`fields returned: ${[...keys].sort().join(', ')}`);
console.log(`services with a non-empty env block: ${withEnv.length}`);
for (const s of withEnv.slice(0, 3)) console.log(`  ${s.name}: ${JSON.stringify(s.env.split('\n').map((l) => l.replace(/=.*/, '=<value redacted in this demo>')))}`);
const sensitive = svcs.filter((s) => ['databasePassword', 'password', 'buildArgs', 'buildSecrets', 'rootPassword'].some((k) => s[k]));
console.log(`services with password/buildArgs/buildSecrets fields: ${sensitive.length}`);
