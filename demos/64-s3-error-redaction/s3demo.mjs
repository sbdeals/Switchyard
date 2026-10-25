// E2E-023: S3 destination Test with synthetic credentials. Shows whether rclone's echoed argv (incl. secret key) reaches the UI.
// usage: BASE=http://127.0.0.1:3002 node s3demo.mjs <label> <outdir>
import { chromium } from 'playwright'; import { login } from './lib.mjs'; import fs from 'fs'; import { execSync } from 'child_process';
const [label, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const AK = 'SYNTHETIC-AK-e2e023', SK = 'SYNTHETIC-SECRET-do-not-show-e2e023';
const sh = (c) => { try { return execSync(c, { shell: '/bin/bash' }).toString().trim(); } catch (e) { return 'ERR'; } };
let r = `## [${label}] ${sh('date "+%H:%M:%S %Z %b %d"')}  dashboard ${process.env.BASE}  image ${sh(`sudo docker inspect ${process.env.CTR} --format '{{.Config.Image}}'`)}\nsynthetic access key ${AK}, synthetic secret ${SK}\n`;
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage(); page.on('dialog', d => d.accept());
await page.setContent(`<body style="background:#0b0b10;color:#e5e5e5;font:20px ui-monospace,monospace;padding:40px"><h2 style="color:#a78bfa">[${label}] E2E-023: S3 destination errors</h2><p>Synthetic keys only.<br>Secret key typed: <b>${SK}</b><br>1. Endpoint <b>not-a-url</b> → Test<br>2. Endpoint <b>http://127.0.0.1:9</b> (nothing listening) → Test<br>Watch whether the secret appears in the error.</p></body>`);
await page.waitForTimeout(4000);
await login(page); await page.waitForTimeout(2000);
// open the demo Postgres created for this demo (name s3demo-pg)
await page.getByText(process.env.DBNAME, { exact: false }).first().click(); await page.waitForTimeout(2000);
await page.getByRole('tab', { name: 'Backups' }).click(); await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Add destination/ }).click(); await page.waitForTimeout(800);
const f = (l) => page.getByLabel(l, { exact: true }).last();
await f('Name').fill('e2e023-demo'); await f('Region').fill('us-east-1'); await f('Bucket').fill('demo-bucket');
await f('Access key').fill(AK); await f('Secret key').fill(SK);
for (const [i, ep] of [[1, 'not-a-url'], [2, 'http://127.0.0.1:9']]) {
  await f('Endpoint').fill(ep); await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^\s*Test\s*$/ }).click();
  await page.waitForFunction(() => document.querySelector('[role=alert],[role=status]'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const alerts = await page.locator('[role=alert],[role=status]').allInnerTexts();
  const summary = alerts.join(' | ').replace(/\s+/g, ' ');
  const det = page.getByText('Show details'); if (await det.count()) { await det.first().click(); await page.waitForTimeout(500); }
  const visible = await page.locator('body').innerText();
  r += `\n### case ${i}: endpoint ${ep}\nerror shown (${summary.length} chars): ${summary.slice(0, 700)}${summary.length > 700 ? ' …' : ''}\nsecret visible on page: ${visible.includes(SK)}   access key visible: ${visible.includes(AK)}\n`;
  await page.screenshot({ path: `${out}/${label}-case${i}.png`, fullPage: false });
  await page.waitForTimeout(2500);
}
fs.writeFileSync(`${out}/${label}-result.txt`, r); console.log(r);
await ctx.close(); await browser.close();
const w = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); execSync(`ffmpeg -loglevel error -y -i ${vdir}/${w} -c:v libx264 -pix_fmt yuv420p ${out}/${label}.mp4`); fs.rmSync(vdir, { recursive: true });
