// v2: polls the public URL until 200 (max 120s). Onboarding empty-state demo as a Dokploy member with no projects. usage: node ob.mjs <label> <outdir>
import { chromium } from 'playwright';
import fs from 'fs'; import { execSync } from 'child_process';
const [label, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const PW = fs.readFileSync(new URL('./.onboard-pass', import.meta.url).pathname, 'utf8').trim();
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:3001' });
const page = await ctx.newPage();
let r = `## [${label}] first-run empty workspace (Dokploy member with no projects)\n`;
await page.goto('http://127.0.0.1:3001/login');
await page.fill('input[name=email]', process.env.OB_EMAIL || 'onboarding-demo@switchyard.local'); await page.fill('input[name=password]', PW);
await page.locator('button[type=submit]').first().click();
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 }); await page.waitForTimeout(3000);
r += `heading: ${(await page.locator('main h2, h2').allInnerTexts()).join(' | ')}\n`;
await page.screenshot({ path: `${out}/${label}-1-empty.png` });
const sample = page.getByRole('button', { name: /Try a sample docker image/ });
if (await sample.count()) {
  await page.getByRole('button', { name: /^Git repository/ }).click(); await page.waitForTimeout(1200);
  r += `Git dialog bridge hint visible: ${await page.getByText('GitHub App / private repos need Swarm', { exact: false }).first().isVisible()}\n`;
  await page.screenshot({ path: `${out}/${label}-2-git-flow.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  await sample.focus(); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${label}-3-sample-focused.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(35000);
  await page.screenshot({ path: `${out}/${label}-4-deployed.png` });
  const url = await page.locator('a[href*="sslip.io"]').first().getAttribute('href').catch(() => null);
  r += `public URL in drawer: ${url}\n`;
  const copy = page.getByRole('button', { name: /copy/i }).first();
  if (await copy.count()) { await copy.click(); await page.waitForTimeout(500); r += `copied: ${await page.evaluate(() => navigator.clipboard.readText()).catch(e => 'n/a')}\n`; }
  if (url) {
    const host = new URL(url).host; const t0 = Date.now(); let code = '';
    while (Date.now() - t0 < 120000) { code = execSync(`curl -s -o /dev/null -w '%{http_code}' -H "Host: ${host}" http://127.0.0.1/`).toString(); r += `t+${Math.round((Date.now()-t0)/1000)}s curl -H "Host: ${host}" http://127.0.0.1/ -> ${code}\n`; if (code === '200') break; await page.waitForTimeout(5000); }
    const ids = execSync(`docker ps -q`).toString().trim().split('\n').filter(Boolean);
    for (const c of JSON.parse(execSync(`docker inspect ${ids.join(' ')}`).toString())) {
      const L = c.Config.Labels || {};
      if (Object.values(L).some(v => String(v).includes(host))) r += `container ${c.Name}: ${Object.entries(L).filter(([k]) => k.endsWith('server.port')).map(([k, v]) => `${k}=${v}`).join(' ')}\n`;
    }
    await page.screenshot({ path: `${out}/${label}-5-served.png` });
  }
} else {
  r += `buttons: ${(await page.getByRole('button').allInnerTexts()).map(t => t.trim()).filter(Boolean).join(', ')}\n`;
  await page.getByRole('button', { name: 'New service' }).last().click(); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${label}-2-menu.png` });
  r += 'no samples, no per-path guidance: one generic "New service" menu\n';
}
fs.writeFileSync(`${out}/${label}-result.txt`, r); console.log(r);
await ctx.close(); await browser.close();
const w = fs.readdirSync(vdir).find(x => x.endsWith('.webm'));
execSync(`ffmpeg -loglevel error -y -i ${vdir}/${w} -c:v libx264 -pix_fmt yuv420p ${out}/${label}.mp4`); fs.rmSync(vdir, { recursive: true });
