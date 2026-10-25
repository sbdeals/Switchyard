// C1 (#53 follow-up): automatic port fix-up must redeploy the image it built, not the branch head.
// Fresh local-git repo app (FIRST, nginx EXPOSE 80, so the watcher must fix the port); SECOND is pushed after the
// first build finishes but before the watcher's fix-up (BRIDGE_REPO_PORT_POLL_MS=60000). usage: node c1pin.mjs <label> <outdir>
import { chromium } from 'playwright'; import { PASS } from './lib.mjs'; import fs from 'fs'; import { execSync } from 'child_process';
const BASE = process.env.BASE || 'http://127.0.0.1:3004', REPO = 'http://127.0.0.1:8765/c1-pin.git', PFX = 'c1-pin';
const [label, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'pipe'], shell: '/bin/bash' }).toString().trim(); } catch (e) { return (e.stdout?.toString().trim()) || `ERR ${e.status}`; } };
let r = `## [${label}] ${sh('date "+%H:%M:%S %Z"')}  dashboard image: ${sh("sudo docker inspect sy-c1r3 --format '{{.Config.Image}}'")}\n`;
const log = (s) => { r += s + '\n'; console.log(s); };
const t0 = Date.now(), t = () => `t+${Math.round((Date.now() - t0) / 1000)}s`;
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
const before = new Set(sh(`sudo ls /etc/dokploy/compose/ | grep '^${PFX}-'`).split('\n'));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await page.goto(BASE + '/login'); await page.fill('input[name=email]', 'admin@switchyard.local'); await page.fill('input[name=password]', PASS);
await page.locator('button[type=submit]').first().click(); await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 }); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'New service' }).first().click(); await page.waitForTimeout(800);
await page.getByPlaceholder('public git repo url').fill(REPO); await page.getByPlaceholder('public git repo url').press('Enter');
let APP = ''; for (let i = 0; i < 40 && !APP; i++) { await page.waitForTimeout(1500); APP = sh(`sudo ls /etc/dokploy/compose/ | grep '^${PFX}-'`).split('\n').find(d => d && !before.has(d)) || ''; }
log(`${t()} app created via New service: ${APP}  (repo ${REPO}, head = FIRST ${sh('git -C /workspace/rb-git/c1-pin.git rev-parse --short main')})`);
const cf = `/etc/dokploy/compose/${APP}/code/docker-compose.yml`;
const q = (sql) => sh(`sudo docker exec dokploy-postgres psql -U dokploy -d dokploy -At -F ' | ' -c "${sql}"`);
const deps = () => q(`select to_char(d.\\"createdAt\\"::timestamptz at time zone 'America/New_York','HH24:MI:SS') || ' EDT', d.title, d.status from deployment d join compose c on c.\\"composeId\\"=d.\\"composeId\\" where c.\\"appName\\"='${APP}' order by d.\\"createdAt\\"`);
const ctr = () => sh(`sudo docker ps -q --filter label=com.docker.compose.project=${APP} | head -1`);
const imgOf = () => { const c = ctr(); return c ? sh(`sudo docker inspect ${c} --format '{{.Image}}'`).slice(7, 19) + ' (' + sh(`sudo docker inspect ${c} --format '{{.Config.Image}}'`) + ')' : '(no container)'; };
const host = () => (sh(`sudo grep -o 'Host(\`[^\`]*' ${cf} | head -1`).match(/Host\(`(.*)/) || [])[1];
const body = () => { const h = host(); return h ? sh(`curl -s --max-time 5 -w ' [%{http_code}]' -H "Host: ${h}" http://127.0.0.1/`) : '(no host)'; };
for (let i = 0; i < 90 && !/done|error/.test(deps()); i++) await page.waitForTimeout(2000);
log(`${t()} first deploy finished: ${deps().split('\n').pop()}  container image ${imgOf()}`);
const firstImg = imgOf();
sh(`cd /workspace/rb-git-work/c1-pin && sed -i 's/FIRST/SECOND/' Dockerfile && git -c user.name=demo -c user.email=demo@local commit -qam SECOND && git push -q /workspace/rb-git/c1-pin.git main && git -C /workspace/rb-git/c1-pin.git update-server-info`);
log(`${t()} pushed SECOND to the repo (head now ${sh('git -C /workspace/rb-git/c1-pin.git rev-parse --short main')}) BEFORE the watcher's fix-up`);
let okAt = null; while ((Date.now() - t0) / 1000 < 400) { const d = deps(); if (d.split('\n').length >= 2 && !/running|queued/.test(d)) { okAt = t(); break; } await page.waitForTimeout(3000); }
await page.waitForTimeout(4000);
log(`${t()} Dokploy deployments (oldest first):\n${deps()}`);
log(`curl app -> ${body()}   port label: ${sh(`sudo grep -o 'server.port=[0-9]*' ${cf} | head -1`)}`);
log(`container image after fix-up: ${imgOf()}   (first build: ${firstImg})  same image: ${imgOf() === firstImg || imgOf().slice(0, 12) === firstImg.slice(0, 12)}`);
await page.waitForTimeout(3000);
log(`compose file now has build: ${sh(`sudo grep -c '^\\s*build:' ${cf}`)} line(s), pinned image: line: ${sh(`sudo grep -cE '^\\s+image: .*snap' ${cf}`)}; history entries: ${sh(`sudo grep -c '^  history:' ${cf}`)}`);
log(`temporary pinned tags left for ${APP}: ${sh(`sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep '^${APP}' | grep -vc ':latest'`)}`);
await page.reload(); await page.waitForTimeout(2500);
await page.getByText(APP.replace(/-[a-z0-9]+$/, ''), { exact: false }).first().click().catch(() => {}); await page.waitForTimeout(2000);
await page.getByRole('tab', { name: 'Deploys' }).click().catch(() => {}); await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${label}-deploys.png` });
fs.writeFileSync(`${out}/${label}-result.txt`, r); fs.writeFileSync(`${out}/${label}-app.txt`, APP);
await ctx.close(); await browser.close();
const w = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); execSync(`ffmpeg -loglevel error -y -i ${vdir}/${w} -c:v libx264 -pix_fmt yuv420p ${out}/${label}.mp4`); fs.rmSync(vdir, { recursive: true });
