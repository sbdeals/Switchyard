// Live: real pg against a throwaway postgres:16 that only starts AFTER the dashboard's first store write fails.
// usage: node live-store.cjs <label> <path/to/store.ts>   (env SWITCHYARD_STORE_URL set by run-live.sh)
const ts = require('/workspace/wt-store-retry/dashboard/node_modules/typescript');
const fs = require('fs'), path = require('path'), Module = require('module');
const [label, file] = process.argv.slice(2);
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = new Module(file); m.paths = Module._nodeModulePaths('/workspace/wt-store-retry/dashboard'); m._compile(js, file);
const store = m.exports; const t0 = Date.now(); const t = () => `t+${String(Math.round((Date.now() - t0) / 1000)).padStart(2)}s`;
const origWarn = console.warn; console.warn = (...a) => origWarn(`${t()}   log:`, ...a.map(String));
(async () => {
  console.log(`## [${label}] ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false })} EDT  store.ts=${file}`);
  let i = 0;
  while ((Date.now() - t0) < 45000) {
    const now = Date.now();
    await store.writeMetric('demo-app', { ts: now, cpu: 1, memUsed: 1, memLimit: 2, memPct: 50 });
    const rows = await store.queryMetrics('demo-app', t0 - 1000, now + 1000);
    if (i++ % 3 === 0 || rows.length) console.log(`${t()} collector tick: write+read -> ${rows.length} rows persisted${store.storeAvailable ? `  storeAvailable=${store.storeAvailable()}` : ''}`);
    if (rows.length >= 3) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`${t()} RESULT: ${((await store.queryMetrics('demo-app', t0 - 1000, Date.now() + 1000)).length) > 0 ? 'persistence RECOVERED after Postgres came up' : 'persistence still OFF (needs dashboard restart)'}`);
  await store.closeStore(); process.exit(0);
})();
