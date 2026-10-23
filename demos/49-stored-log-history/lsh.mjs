// Stored log history demo: logs persisted by the collector, container then stopped, open Logs tab.
import { open, login } from './lib.mjs';
import fs from 'fs';
import { execSync } from 'child_process';
const [label, out] = process.argv.slice(2);
const C = 'app-input-bluetooth-panel-c7aegs.1.logdemo';
const sh = (c) => execSync(c, { encoding: 'utf8' });
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
const { browser, ctx, page } = await open({ video: vdir });
await page.setContent(`<body style="background:#0b0b10;color:#e5e5e5;font:20px ui-monospace,monospace;padding:40px"><h2 style="color:#a78bfa">[${label}] Logs tab after a service stops</h2><p>The dashboard runs with a log store (Postgres) and the collector every 5s.</p><p>registry-app's container prints "=== container started ===" and tick 1..5. We let the collector persist those lines, then run <b>docker stop</b>, then open Logs.</p><p>Expected: the last persisted lines, marked "from history", above "container is not running". Bug: only "container is not running"; the crash context is gone.</p></body>`);
await page.waitForTimeout(5000);
await login(page); await page.waitForTimeout(2000);           // workspace load starts the collector
await page.goto('http://127.0.0.1:3001/'); await page.waitForTimeout(15000); // >= 2 collector ticks
const persisted = sh(`docker exec sy-demo-store psql -U postgres -d switchyard -tAc "select count(*) from log_lines where app_name='app-input-bluetooth-panel-c7aegs'"`).trim();
sh(`docker stop -t 1 ${C}`);
await page.reload(); await page.waitForTimeout(2500);
await page.getByText('registry-app', { exact: true }).first().click(); await page.waitForTimeout(1200);
await page.getByText('Logs', { exact: true }).first().click(); await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/${label}-logs-after-stop.png` });
const text = await page.locator('[aria-label="Service logs"]').innerText().catch(() => page.locator('body').innerText());
await page.waitForTimeout(1500);
await ctx.close(); await browser.close();
const v = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); fs.renameSync(`${vdir}/${v}`, `${out}/${label}.webm`); fs.rmSync(vdir, { recursive: true });
fs.writeFileSync(`${out}/${label}-logs.txt`, text);
console.log(`${label}: rows persisted in store before stop: ${persisted}; "tick" lines shown: ${(text.match(/tick \d/g) || []).length}; "from history": ${text.includes('from history')}; "not running": ${text.includes('not running')}`);
