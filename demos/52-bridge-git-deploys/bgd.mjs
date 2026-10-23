// Bridge git deploys demo: quick deploy a public Dockerfile repo on the bridge stack.
// usage: node bgd.mjs <label> <outdir> [waitSec]
import { chromium } from 'playwright';
import { login } from './lib.mjs';
import fs from 'fs';
import { execSync } from 'child_process';
const [label, out, waitS = '150'] = process.argv.slice(2);
const REPO = 'https://github.com/docker/welcome-to-docker';
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--host-resolver-rules=MAP *.sslip.io 127.0.0.1, MAP *.traefik.me 127.0.0.1'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
const t0 = Math.floor(Date.now() / 1000);
await page.setContent(`<body style="background:#0b0b10;color:#e5e5e5;font:20px ui-monospace,monospace;padding:40px"><h2 style="color:#a78bfa">[${label}] Bridge mode: deploy a public Git repo</h2><p>Repo: <b>${REPO}</b> (branch main, Dockerfile at root, Node app on :3000)</p><p>Bridge hosts (no Swarm/overlay) can't run native Dokploy applications. Expected Railway-style result: it builds, runs, and gets a public URL.</p></body>`);
await page.waitForTimeout(4000);
await login(page); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'New service' }).click(); await page.waitForTimeout(800);
const inp = page.getByLabel('Git repository URL');
await inp.type(REPO, { delay: 15 });
await page.screenshot({ path: `${out}/${label}-1-menu.png` });
await inp.press('Enter');
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/${label}-2-created.png` });
for (const t of ['Deploys', 'Deployments']) { const el = page.getByText(t, { exact: true }).first(); if (await el.count()) { await el.click().catch(() => {}); break; } }
await page.waitForTimeout(Number(waitS) * 1000);
await page.screenshot({ path: `${out}/${label}-3-after-build.png` });
await page.getByText('Networking', { exact: true }).first().click().catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${label}-4-networking.png` });
let report = '';
const ps = execSync(`docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.CreatedAt}}' --filter since=dokploy`).toString();
const fresh = execSync(`docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Label "com.docker.compose.project"}}' `).toString().split('\n').filter(l => l.includes('welcome-to-docker'));
report += `containers matching welcome-to-docker:\n${fresh.map(l => '  ' + l).join('\n') || '  (none)'}\n`;
let svc = '';
try { svc = execSync(`docker service ls --format '{{.Name}} {{.Replicas}}' | grep welcome-to-docker || true`).toString(); } catch {}
report += `swarm services matching:\n  ${svc.trim() || '(none)'}\n`;
const c = fresh.map(l => l.split('|')).find(f => f[2].startsWith('Up'));
if (c) {
  const labels = JSON.parse(execSync(`docker inspect ${c[0]} --format '{{json .Config.Labels}}'`).toString());
  const tl = Object.entries(labels).filter(([k]) => k.startsWith('traefik.'));
  report += tl.map(([k, v]) => `  ${k}=${v}`).join('\n') + '\n';
  const host = (tl.map(([, v]) => v).join(' ').match(/Host\(`([^`]+)`\)/) || [])[1];
  if (host) {
    report += `curl -H "Host: ${host}" http://127.0.0.1/ -> ` + execSync(`curl -s -o /dev/null -w '%{http_code}' -H "Host: ${host}" http://127.0.0.1/`).toString() + '\n';
    const p2 = await ctx.newPage(); await p2.goto(`http://${host}/`).catch(() => {}); await p2.waitForTimeout(3000);
    await p2.screenshot({ path: `${out}/${label}-5-public-url.png` }); await p2.close();
  } else report += 'no public hostname\n';
} else report += 'no running container for the repo\n';
fs.writeFileSync(`${out}/${label}-result.txt`, report);
console.log(report);
await ctx.close(); await browser.close();
const v = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
execSync(`ffmpeg -loglevel error -y -i ${vdir}/${v} -c:v libx264 -pix_fmt yuv420p ${out}/${label}.mp4`); fs.rmSync(vdir, { recursive: true });
