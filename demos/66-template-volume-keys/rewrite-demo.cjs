// Runs rewriteDataBindsToVolumes from a given template-volumes.ts on template.yml, then asks `docker compose config` to parse the result.
// usage: node rewrite-demo.cjs <label> <template-volumes.ts>
const ts = require('/workspace/wt-store-retry/dashboard/node_modules/typescript'); const fs = require('fs'), Module = require('module'), { execSync } = require('child_process');
const [label, file] = process.argv.slice(2);
const m = new Module(file); m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const input = fs.readFileSync(__dirname + '/template.yml', 'utf8'); const out = m.exports.rewriteDataBindsToVolumes(input);
console.log(`## [${label}] ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false })} EDT  ${file}\n--- template (two sources differing only by _ vs -) ---\n${input}--- rewritten compose ---\n${out.compose}\nrewritten: ${JSON.stringify(out.rewritten.map(r => `${r.source} -> ${r.volume}`))}${out.error ? `\nwarning: ${out.error}` : ''}`);
fs.writeFileSync('/tmp/tvk-out.yml', out.compose);
let res; try { res = 'OK\n' + execSync('sudo docker compose -p tvkdemo -f /tmp/tvk-out.yml config --volumes 2>&1', { shell: '/bin/bash' }).toString(); } catch (e) { res = 'FAILED\n' + e.stdout.toString(); }
console.log(`--- docker compose config --volumes ---\n${res}`);
