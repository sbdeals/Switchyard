// Round Q (#53): automatic port fix-up deploy is the same release. Create a local-Git repo app via New service,
// never click Redeploy, wait for watcher fix-up + 200, then show Dokploy deployment titles, x-switchyard history,
// Overview "Previous deploys" note and Deploys tab. usage: node rq.mjs <label> <outdir> <repoURL> <appPrefix> [maxSec]
import { chromium } from 'playwright'; import { login } from './lib.mjs';
import fs from 'fs'; import { execSync } from 'child_process';
const [label, out, REPO, PFX, maxS = '300'] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); } catch (e) { return `ERR ${e.status}`; } };
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
let r = `## [${label}] fresh local-Git repo app ${REPO} (no manual Redeploy) — ${sh('date "+%H:%M:%S %Z"')}\nimage: ${sh("docker inspect switchyard --format '{{.Config.Image}}'")}\n`;
const log = (s) => { r += s + '\n'; console.log(s); };
const before = new Set(sh(`ls -d /etc/dokploy/compose/${PFX}-*/ 2>/dev/null`).split('\n'));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await login(page); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'New service' }).click(); await page.waitForTimeout(800);
await page.getByPlaceholder('public git repo url').fill(REPO);
await page.getByPlaceholder('public git repo url').press('Enter');
const t0 = Date.now(); let APP = '';
for (let i = 0; i < 40 && !APP; i++) { await page.waitForTimeout(2000); APP = sh(`ls -d /etc/dokploy/compose/${PFX}-*/ 2>/dev/null`).split('\n').find(d => d && !before.has(d))?.replace(/.*compose\/|\/$/g, '') || ''; }
log(`app: ${APP}`);
fs.writeFileSync(`${out}/app.txt`, APP);
const cf = () => `/etc/dokploy/compose/${APP}/code/docker-compose.yml`;
const host = () => (sh(`grep -o 'Host(\`[^\`]*' ${cf()} | head -1`).match(/Host\(`(.*)/) || [])[1];
const port = () => sh(`grep -o 'server.port=[0-9]*' ${cf()} | head -1`);
const deps = () => sh(`docker exec dokploy-postgres psql -U dokploy -d dokploy -At -F ' | ' -c "select to_char(d.\\"createdAt\\"::timestamptz at time zone 'America/New_York','HH24:MI:SS') || ' EDT', d.title, d.status, coalesce(d.description,'') from deployment d join compose c on c.\\"composeId\\"=d.\\"composeId\\" where c.\\"appName\\"='${APP}' order by d.\\"createdAt\\""`);
let last = '', okAt = null;
while ((Date.now() - t0) / 1000 < +maxS) {
  const h = host(); const code = h ? sh(`curl -s -o /dev/null --max-time 5 -w '%{http_code}' -H "Host: ${h}" http://127.0.0.1/`) : '(no host)';
  const cur = `${code} ${port() || '(no port label)'}`;
  if (cur !== last) { log(`t+${Math.round((Date.now() - t0) / 1000)}s curl ${h || ''} -> ${cur}`); last = cur; }
  if (code === '200') { okAt = Math.round((Date.now() - t0) / 1000); break; }
  await page.waitForTimeout(4000);
}
log(okAt != null ? `RESULT: 200 at t+${okAt}s with ${port()} and NO manual Redeploy` : `RESULT: no 200 within ${maxS}s (last: ${last})`);
for (let i = 0; i < 15 && /running|queued/.test(deps()); i++) await page.waitForTimeout(2000);
log(`\nDokploy deployments for ${APP} (oldest first):\n${deps()}`);
log(`\nx-switchyard block (rollback history lives here as 'history:'):\n${sh(`sed -n '/^x-switchyard:/,/^services:/p' ${cf()} | grep -v '^services:'`)}`);
log(`history entries: ${sh(`grep -c '^  history:' ${cf()}`)} (0 = no rollback entry for the fix-up)`);
log(`rollback snapshot images for ${APP}: ${sh(`docker images --format '{{.Repository}}:{{.Tag}}' | grep '^${APP}' | grep -v ':latest' | wc -l`)}`);
await page.reload(); await page.waitForTimeout(2500);
await page.getByText(APP.replace(/-[a-z0-9]+$/, ''), { exact: false }).first().click().catch(() => {}); await page.waitForTimeout(2000);
await page.getByRole('tab', { name: 'Overview' }).click().catch(() => {}); await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/${label}-1-overview-previous-deploys.png` });
const note = await page.getByText('Includes an automatic port fix-up (same release).').count();
log(`UI note "Includes an automatic port fix-up (same release)." visible: ${note > 0}`);
await page.getByRole('tab', { name: 'Deploys' }).click().catch(() => {}); await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${label}-2-deploys.png` });
fs.writeFileSync(`${out}/${label}-result.txt`, r);
await ctx.close(); await browser.close();
const w = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
execSync(`ffmpeg -loglevel error -y -i ${vdir}/${w} -c:v libx264 -pix_fmt yuv420p ${out}/${label}.mp4`); fs.rmSync(vdir, { recursive: true });
