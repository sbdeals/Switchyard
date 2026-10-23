// #53 rollback with a REAL code change: deploy repo @A, push commit B, redeploy (B live), Roll back (A live, no build), Redeploy latest (B).
// Repo is served by dumb-HTTP git from /workspace/rb-git on :8765. usage: node rbcode.mjs <outdir>
import { chromium } from 'playwright'; import { login } from './lib.mjs';
import fs from 'fs'; import { execSync } from 'child_process';
const [out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); } catch (e) { return `ERR ${e.status}`; } };
const vdir = `${out}/video-code`; fs.rmSync(vdir, { recursive: true, force: true });
const REPO = 'http://127.0.0.1:8765/rb-demo.git';
let r = `## [after] #53 rollback of a real code change (repo ${REPO})\n`;
const log = (s) => { r += s + '\n'; console.log(s); };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage(); page.on('dialog', d => d.accept());
let APP = '';
const cid = () => sh(`docker ps -q --filter label=com.docker.compose.project=${APP} --filter label=com.docker.compose.service=app | head -1`);
const host = () => (sh(`grep -o 'Host(\`[^\`]*' /etc/dokploy/compose/${APP}/code/docker-compose.yml | head -1`).match(/Host\(`(.*)/) || [])[1];
const body = () => sh(`curl -s -H "Host: ${host()}" http://127.0.0.1/ | grep -o '<h1>.*</h1>'`) || '(no h1)';
const state = (label) => { const c = cid(); log(`[${label}] container image ${c ? sh(`docker inspect ${c} --format '{{.Config.Image}} {{slice .Image 7 19}}'`) : '(none)'} | curl -> ${body()}`); };
const waitFor = async (re, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (re.test(body())) return true; await page.waitForTimeout(5000); } return false; };
const openDrawer = async () => {
  await page.keyboard.press('Escape'); await page.reload(); await page.waitForTimeout(2500);
  await page.getByText(APP.replace(/-[a-z0-9]{6}$/, ''), { exact: false }).first().click(); await page.waitForTimeout(1500);
  await page.getByRole('tab', { name: 'Overview' }).click().catch(() => {}); await page.waitForTimeout(1200);
};
await login(page); await page.waitForTimeout(2000);
log(`$ git log --oneline (served repo)\n${sh('git -C /workspace/rb-git/rb-demo.git log --oneline main')}`);
await page.getByRole('button', { name: 'New service' }).click(); await page.waitForTimeout(800);
await page.getByPlaceholder('public git repo url').fill(REPO);
await page.getByPlaceholder('public git repo url').press('Enter');
for (let i = 0; i < 30 && !APP; i++) { await page.waitForTimeout(3000); APP = sh(`ls -td /etc/dokploy/compose/rb-demo-*/ 2>/dev/null | head -1 | xargs -r basename`); }
log(`app: ${APP}`);
let okA = await waitFor(/Version A/, 150000);
if (!okA) {
  // Known #52-fix behaviour: a fresh repo app has no local image at create time, so its auto-URL
  // starts on fallback port 3000; the next requested deploy reconciles it to the image's EXPOSE (80).
  state('first deploy (fallback port)');
  log(`first deploy routed to port ${sh(`grep -o 'server.port=[0-9]*' /etc/dokploy/compose/${APP}/code/docker-compose.yml | head -1`)} -> clicking Redeploy once to let the port reconcile run`);
  await openDrawer(); await page.getByRole('dialog').getByRole('button', { name: /^(Redeploy|Deploy)$/ }).first().click();
  okA = await waitFor(/Version A/, 180000);
  log(`after reconcile: ${sh(`grep -o 'server.port=[0-9]*' /etc/dokploy/compose/${APP}/code/docker-compose.yml | head -1`)}`);
}
log(`commit A live: ${okA}`); state('deployed @A');
await page.screenshot({ path: `${out}/code-1-version-a.png` });
// real code change: commit B
sh(`cd /workspace/rb-demo-src && echo '<h1>Version B — commit 2 (new code)</h1>' > index.html && git -c user.name=demo -c user.email=demo@local commit -qam "v2: Version B" && git push -q /workspace/rb-git/rb-demo.git main && git -C /workspace/rb-git/rb-demo.git update-server-info`);
log(`$ git push (commit B)\n${sh('git -C /workspace/rb-git/rb-demo.git log --oneline main')}`);
await openDrawer();
await page.getByRole('dialog').getByRole('button', { name: /^(Redeploy|Deploy)$/ }).first().click();
log(`commit B live after Redeploy: ${await waitFor(/Version B/, 180000)}`); state('redeployed @B');
log(`snapshot tags: ${sh(`docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep '^${APP}-app:' | tr '\\n' ' '`)}`);
await openDrawer(); await page.screenshot({ path: `${out}/code-2-version-b.png` });
const rb = page.getByRole('dialog').getByRole('button', { name: /Roll back/ });
log(`Roll back buttons: ${await rb.count()}`);
await rb.first().click();
log(`commit A live again after Roll back: ${await waitFor(/Version A/, 120000)}`); state('rolled back');
const cf = sh(`cat /etc/dokploy/compose/${APP}/code/docker-compose.yml`);
log(`compose after rollback: build section: ${/\n\s+build:/.test(cf)}; pull_policy never: ${/pull_policy:\s*never/.test(cf)}; pinnedTag: ${(cf.match(/pinnedTag:\s*(\S+)/) || [])[1]}`);
await openDrawer(); await page.screenshot({ path: `${out}/code-3-rolled-back.png` });
const latest = page.getByRole('dialog').getByRole('button', { name: /Redeploy latest from/ });
log(`"Redeploy latest" button: ${await latest.count()}`);
if (await latest.count()) { await latest.first().click(); log(`commit B live after Redeploy latest: ${await waitFor(/Version B/, 180000)}`); state('redeploy latest'); }
await openDrawer(); await page.getByRole('tab', { name: 'Deploys' }).click().catch(() => {}); await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/code-4-deploys.png` });
fs.writeFileSync(`${out}/code-result.txt`, r);
await ctx.close(); await browser.close();
const w = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
execSync(`ffmpeg -loglevel error -y -i ${vdir}/${w} -c:v libx264 -pix_fmt yuv420p ${out}/code-after.mp4`); fs.rmSync(vdir, { recursive: true });
