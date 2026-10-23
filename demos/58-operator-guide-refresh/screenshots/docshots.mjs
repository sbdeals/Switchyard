// Re-take operator-guide screenshots on a MAIN build (BASE=:3002). usage: node docshots.mjs <outdir> create|shoot [app] [db]
import { chromium } from 'playwright'; import { login } from './lib.mjs'; import fs from 'fs';
const [out, phase, APP, DB] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }); const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: `${out}/${n}` });
const w = (ms) => page.waitForTimeout(ms);
await login(page); await w(2500);
const menu = async () => { await page.getByRole('button', { name: 'New service' }).click(); await w(900); };
if (phase === 'create') {
  await menu(); await shot('new-service-menu.png');
  await page.getByPlaceholder(/docker image/).fill('traefik/whoami'); await w(400); await shot('deploy-image-filled.png');
  await page.getByRole('button', { name: 'Deploy' }).first().click(); await w(5000);
  await page.keyboard.press('Escape'); await w(500);
  await menu(); await page.getByText('Redis', { exact: true }).click(); await w(6000);
  await page.goto(page.url()); await w(3000);
  console.log('names', [...new Set((await page.locator('body').innerText()).match(/\b(whoami|redis)-[a-z0-9]{4}\b/g) || [])]);
} else {
  const open = async (name) => { await page.goto(page.url()); await w(2500); await page.getByText(name, { exact: true }).first().click(); await w(2000); };
  const tab = async (name, ms = 1500) => { await page.getByRole('tab', { name }).click(); await w(ms); };
  await open(DB); await shot('db-overview.png');
  const conn = (await page.locator('code, input[readonly]').allTextContents()).find(t => /redis:\/\//.test(t)) ||
    (await page.locator('input[readonly]').evaluateAll(els => els.map(e => e.value))).find(t => /redis:\/\//.test(t)) || '';
  console.log('conn', conn ? conn.replace(/:[^:@/]+@/, ':***@') : '(none)');
  await tab('Logs', 5000); await shot('db-logs.png');
  await tab('Metrics', 15000); await shot('db-metrics.png');
  await tab('Settings', 1500); await shot('db-settings.png');
  await open(APP); await shot('app-overview.png');
  await tab('Variables', 1500);
  if (conn) { await page.locator('textarea').first().fill(`REDIS_URL=${conn}`); await w(300); await page.getByRole('button', { name: /Save variables/ }).click(); await w(2500); }
  await shot('app-variables.png');
  await tab('Networking', 2000); await shot('app-domains.png');
  await page.keyboard.press('Escape'); await w(500);
  await menu(); await page.getByText('Compose stack', { exact: true }).click(); await w(5000);
  await tab('Compose', 2500).catch(() => {}); await shot('compose-editor.png');
}
await b.close();
