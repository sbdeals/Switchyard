// First-deploy port demo for a Dockerfile repo app: create via "New service" git field, NEVER click Redeploy,
// poll the public URL + routed port. usage: node rp.mjs <label> <outdir> <repoURL> <appPrefix> [maxSec]
import { chromium } from 'playwright'; import { login } from './lib.mjs';
import fs from 'fs'; import { execSync } from 'child_process';
const [label, out, REPO, PFX, maxS = '480'] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); } catch (e) { return `ERR ${e.status}`; } };
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
let r = `## [${label}] first deploy of Dockerfile repo ${REPO} (no manual Redeploy) — ${sh('date "+%H:%M:%S %Z"')}\nimage: ${sh("docker inspect switchyard --format '{{.Config.Image}}'")}\n`;
const log = (s) => { r += s + '\n'; console.log(s); };
const before = new Set(sh(`ls -d /etc/dokploy/compose/${PFX}-*/ 2>/dev/null`).split('\n'));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await login(page); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'New service' }).click(); await page.waitForTimeout(800);
await page.getByPlaceholder('public git repo url').fill(REPO);
await page.screenshot({ path: `${out}/${label}-1-new-service.png` });
await page.getByPlaceholder('public git repo url').press('Enter');
const t0 = Date.now(); let APP = '';
for (let i = 0; i < 40 && !APP; i++) { await page.waitForTimeout(2000); APP = sh(`ls -d /etc/dokploy/compose/${PFX}-*/ 2>/dev/null`).split('\n').find(d => d && !before.has(d))?.replace(/.*compose\/|\/$/g, '') || ''; }
log(`app: ${APP}`);
const cf = () => `/etc/dokploy/compose/${APP}/code/docker-compose.yml`;
const host = () => (sh(`grep -o 'Host(\`[^\`]*' ${cf()} | head -1`).match(/Host\(`(.*)/) || [])[1];
const port = () => sh(`grep -o 'server.port=[0-9]*' ${cf()} | head -1`);
let last = '', shot = false, okAt = null;
while ((Date.now() - t0) / 1000 < +maxS) {
  const h = host(); const code = h ? sh(`curl -s -o /dev/null --max-time 5 -w '%{http_code}' -H "Host: ${h}" http://127.0.0.1/`) : '(no host)';
  const cur = `${code} ${port() || '(no port label)'} containers:${sh(`docker ps -q --filter label=com.docker.compose.project=${APP} | wc -l`)}`;
  if (cur !== last) { log(`t+${Math.round((Date.now() - t0) / 1000)}s curl ${h || ''} -> ${cur}`); last = cur; }
  if (code === '200') { okAt = Math.round((Date.now() - t0) / 1000); break; }
  if (!shot && /^502/.test(cur)) { await page.reload(); await page.waitForTimeout(2000); await page.screenshot({ path: `${out}/${label}-2-first-502.png` }); shot = true; }
  await page.waitForTimeout(5000);
}
log(okAt != null ? `RESULT: 200 at t+${okAt}s with ${port()} and NO manual Redeploy` : `RESULT: no 200 within ${maxS}s (last: ${last}) and NO manual Redeploy`);
log(`deployments recorded by Dokploy for ${APP}: ${sh(`ls /etc/dokploy/logs/${APP}/ 2>/dev/null | wc -l`)}`);
await page.reload(); await page.waitForTimeout(2500);
await page.getByText(PFX, { exact: false }).first().click().catch(() => {}); await page.waitForTimeout(1500);
await page.getByRole('tab', { name: 'Deploys' }).click().catch(() => {}); await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/${label}-3-deploys.png` });
fs.writeFileSync(`${out}/${label}-result.txt`, r);
await ctx.close(); await browser.close();
const w = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
execSync(`ffmpeg -loglevel error -y -i ${vdir}/${w} -c:v libx264 -pix_fmt yuv420p ${out}/${label}.mp4`); fs.rmSync(vdir, { recursive: true });
