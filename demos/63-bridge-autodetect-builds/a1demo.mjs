// A: deploy public repos WITHOUT a Dockerfile via New service (Node, Python, Go, static). usage: BASE=http://127.0.0.1:3003 node a1demo.mjs <label> <outdir>
import { chromium } from 'playwright'; import { PASS } from './lib.mjs'; import fs from 'fs'; import { execSync } from 'child_process';
const BASE = process.env.BASE || 'http://127.0.0.1:3003';
const REPOS = (process.env.REPOS || 'https://github.com/heroku/nodejs-getting-started,https://github.com/render-examples/flask-hello-world,https://github.com/heroku/go-getting-started,https://github.com/mdn/beginner-html-site-styled').split(',');
const [label, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'pipe'], shell: '/bin/bash', maxBuffer: 64e6 }).toString().trim(); } catch (e) { return (e.stdout?.toString().trim()) || `ERR ${e.status}`; } };
let r = `## [${label}] ${sh('date "+%H:%M:%S %Z %b %d"')}  dashboard image: ${sh("sudo docker inspect sy-a --format '{{.Config.Image}}'")}\n`;
const log = (s) => { r += s + '\n'; console.log(s); };
const q = (sql) => sh(`sudo docker exec dokploy-postgres psql -U dokploy -d dokploy -At -F ' | ' -c "${sql}"`);
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await page.goto(BASE + '/login'); await page.fill('input[name=email]', 'admin@switchyard.local'); await page.fill('input[name=password]', PASS);
await page.locator('button[type=submit]').first().click(); await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000 }); await page.waitForTimeout(2000);
const apps = [];
for (const repo of REPOS) {
  const slug = repo.split('/').pop(); const t0 = Date.now(); const t = () => `t+${Math.round((Date.now() - t0) / 1000)}s`;
  const before = new Set(sh(`sudo ls /etc/dokploy/compose/`).split('\n'));
  await page.getByRole('button', { name: 'New service' }).first().click(); await page.waitForTimeout(800);
  const box = page.getByPlaceholder('public git repo url'); await box.fill(repo); await box.press('Enter');
  let APP = '', err = '';
  for (let i = 0; i < 40 && !APP; i++) {
    await page.waitForTimeout(1500);
    APP = sh(`sudo ls /etc/dokploy/compose/`).split('\n').find(d => d && !before.has(d)) || '';
    if (!APP && i > 6) { const txt = await page.locator('[role=dialog], [role=alert], form').allInnerTexts().catch(() => []); const m = txt.join('\n').split('\n').find(l => /dockerfile|could not|error|unsupported|failed/i.test(l)); if (m) { err = m; break; } }
  }
  if (!APP) { log(`\n### ${slug}\n${t()} NOT CREATED. UI said: ${err || '(no message captured)'}`); await page.screenshot({ path: `${out}/${label}-${slug}-error.png` }); await page.keyboard.press('Escape'); await page.waitForTimeout(800); continue; }
  apps.push(APP); log(`\n### ${slug}\n${t()} app created via New service: ${APP}`);
  const deps = () => q(`select d.status from deployment d join compose c on c.\\"composeId\\"=d.\\"composeId\\" where c.\\"appName\\"='${APP}' order by d.\\"createdAt\\"`);
  // Live build log: open the service's Deploys tab while the build is running.
  await page.waitForTimeout(6000);
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByText(APP.replace(/-[a-z0-9]+$/, ''), { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(1500);
  await page.getByRole('tab', { name: 'Deploys' }).click().catch(() => {}); await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/${label}-${slug}-building.png` });
  for (let i = 0; i < 200 && !/done|error/.test(deps()); i++) await page.waitForTimeout(3000);
  await page.waitForTimeout(5000);
  const cf = `/etc/dokploy/compose/${APP}/code/docker-compose.yml`;
  const host = (sh(`sudo grep -o 'Host(\`[^\`]*' ${cf} | head -1`).match(/Host\(`(.*)/) || [])[1];
  let code = ''; for (let i = 0; i < 20; i++) { code = host ? sh(`curl -s -o /tmp/a-body.txt --max-time 5 -w '%{http_code}' -H "Host: ${host}" http://127.0.0.1/`) : 'no-host'; if (code === '200') break; await page.waitForTimeout(3000); }
  log(`${t()} deployments: ${deps().replace(/\n/g, ', ')}`);
  log(`port label: ${sh(`sudo grep -o 'server.port=[0-9]*' ${cf} | head -1`)}   build: ${sh(`sudo grep -c 'dockerfile_inline' ${cf}`)} dockerfile_inline line(s)`);
  log(`curl http://${host}/ via Traefik -> ${code}  <title>${sh("grep -o '<title>[^<]*' /tmp/a-body.txt | head -1 | cut -c8-80") || sh('head -c 80 /tmp/a-body.txt')}`);
  await page.reload(); await page.waitForTimeout(2500);
  await page.getByText(APP.replace(/-[a-z0-9]+$/, ''), { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(2500);
  const ov = (await page.locator('body').innerText()).split('\n').filter(l => /build|detect|node|python|go |static|nginx|port/i.test(l)).slice(0, 6).join(' | ');
  log(`Overview lines: ${ov}`);
  await page.screenshot({ path: `${out}/${label}-${slug}-overview.png` });
  await page.getByRole('tab', { name: 'Deploys' }).click().catch(() => {}); await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/${label}-${slug}-deploys.png` });
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(800);
}
fs.writeFileSync(`${out}/${label}-result.txt`, r); fs.writeFileSync(`${out}/${label}-apps.txt`, apps.join('\n'));
await ctx.close(); await browser.close();
const w = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); execSync(`ffmpeg -loglevel error -y -i ${vdir}/${w} -c:v libx264 -pix_fmt yuv420p ${out}/${label}.mp4`); fs.rmSync(vdir, { recursive: true });
