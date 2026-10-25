// C1 r3: after the fix-up, Stop/Start must keep serving FIRST (on-disk compose still pins the -portfix tag), and a later
// explicit Redeploy serves the branch head (SECOND) and then prunes the -portfix tag. usage: BASE=... node c1r3.mjs <APP> <outdir>
import { chromium } from 'playwright'; import { PASS } from './lib.mjs'; import fs from 'fs'; import { execSync } from 'child_process';
const BASE = process.env.BASE || 'http://127.0.0.1:3004'; const [APP, out] = process.argv.slice(2);
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'pipe'], shell: '/bin/bash' }).toString().trim(); } catch (e) { return (e.stdout?.toString().trim()) || `ERR ${e.status}`; } };
let r = `## [r3 stop/start + redeploy] ${sh('date "+%H:%M:%S %Z"')}  app ${APP}\n`; const log = (s) => { r += s + '\n'; console.log(s); };
const cf = `/etc/dokploy/compose/${APP}/code/docker-compose.yml`;
const host = (sh(`sudo grep -o 'Host(\`[^\`]*' ${cf} | head -1`).match(/Host\(`(.*)/) || [])[1];
const body = async () => { let b = ''; for (let i = 0; i < 10; i++) { b = sh(`curl -s --max-time 5 -w ' [%{http_code}]' -H "Host: ${host}" http://127.0.0.1/`); if (b.endsWith('[200]')) break; await new Promise(z => setTimeout(z, 2000)); } return b; };
const tags = () => sh(`sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep '^${APP}-app:' | grep -v ':latest' | tr '\\n' ' '`) || '(none)';
const q = (sql) => sh(`sudo docker exec dokploy-postgres psql -U dokploy -d dokploy -At -F ' | ' -c "${sql}"`);
const deps = () => q(`select d.title, d.status from deployment d join compose c on c.\\"composeId\\"=d.\\"composeId\\" where c.\\"appName\\"='${APP}' order by d.\\"createdAt\\"`);
const vdir = `${out}/video-r3`; fs.rmSync(vdir, { recursive: true, force: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await page.goto(BASE + '/login'); await page.fill('input[name=email]', 'admin@switchyard.local'); await page.fill('input[name=password]', PASS);
await page.locator('button[type=submit]').first().click(); await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000 }); await page.waitForTimeout(2000);
await page.getByText(APP.replace(/-[a-z0-9]+$/, ''), { exact: true }).first().click(); await page.waitForTimeout(2000);
log(`start: curl -> ${await body()}   image tags: ${tags()}   on-disk image: ${sh(`sudo grep -oE 'image: \\S+' ${cf} | head -1`)}`);
const click = async (name) => { await page.getByRole('button', { name: new RegExp('^\\W*' + name + '$') }).first().click(); await page.waitForTimeout(1200); const c = page.getByRole('alertdialog').getByRole('button', { name: new RegExp(name, 'i') }); if (await c.count()) await c.last().click(); };
await click('Stop'); for (let i = 0; i < 20 && sh(`sudo docker ps -q --filter label=com.docker.compose.project=${APP}`); i++) await page.waitForTimeout(1500);
log(`after Stop (UI): containers running: ${sh(`sudo docker ps -q --filter label=com.docker.compose.project=${APP} | wc -l`)}   curl -> ${sh(`curl -s --max-time 5 -o /dev/null -w '%{http_code}' -H "Host: ${host}" http://127.0.0.1/`)}`);
await page.screenshot({ path: `${out}/r3-stopped.png` });
await page.waitForTimeout(1500); await click('Start'); await page.waitForTimeout(8000);
log(`after Start (UI): curl -> ${await body()}   container image: ${sh(`sudo docker inspect $(sudo docker ps -q --filter label=com.docker.compose.project=${APP} | head -1) --format '{{.Config.Image}}'`)}`);
await page.screenshot({ path: `${out}/r3-started.png` });
await click('Redeploy'); await page.waitForTimeout(3000);
for (let i = 0; i < 90 && /running|queued/.test(deps()); i++) await page.waitForTimeout(2000);
await page.waitForTimeout(4000);
log(`after explicit Redeploy (UI): deployments:\n${deps()}\ncurl -> ${await body()}`);
let t = tags(); for (let i = 0; i < 30 && /portfix/.test(t); i++) { await page.waitForTimeout(2000); t = tags(); }
log(`after cleanup: image tags: ${t}   history entries: ${sh(`sudo grep -c 'image: ${APP}-app:sy-' ${cf}`)} (x-switchyard history images in on-disk compose)`);
await page.getByRole('tab', { name: 'Deploys' }).click().catch(() => {}); await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/r3-redeployed-deploys.png` });
fs.writeFileSync(`${out}/r3-result.txt`, r);
await ctx.close(); await browser.close();
const w = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); execSync(`ffmpeg -loglevel error -y -i ${vdir}/${w} -c:v libx264 -pix_fmt yuv420p ${out}/r3-stopstart-redeploy.mp4`); fs.rmSync(vdir, { recursive: true });
