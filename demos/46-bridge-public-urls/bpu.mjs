// Bridge public URLs demo: quick deploy nginx:alpine on the bridge stack, then open its URL.
// usage: node bpu.mjs <label> <outdir>
import { chromium } from 'playwright';
import { BASE, login } from './lib.mjs';
import fs from 'fs';
import { execSync } from 'child_process';
const [label, out] = process.argv.slice(2);
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
// The public IP isn't reachable from this VM, so map sslip.io/traefik.me hostnames to the local Traefik (:80).
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--host-resolver-rules=MAP *.sslip.io 127.0.0.1, MAP *.traefik.me 127.0.0.1'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
const before = new Set(execSync(`docker ps --filter ancestor=nginx:alpine --format '{{.Names}}'`).toString().split('\n').filter(Boolean));
await page.setContent(`<body style="background:#0b0b10;color:#e5e5e5;font:20px ui-monospace,monospace;padding:40px"><h2 style="color:#a78bfa">[${label}] Bridge mode: quick deploy <b>nginx:alpine</b></h2><p>Railway-style expectation: one click → a working public URL.</p><p>Bridge (no Swarm) deploys run as Docker Compose stacks. Before this change they get <b>no domain and no Traefik labels</b>, so there's nothing to open.</p></body>`);
await page.waitForTimeout(3500);
await login(page); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'New service' }).click(); await page.waitForTimeout(800);
const img = page.getByLabel('Docker image');
await img.type('nginx:alpine', { delay: 30 });
await page.screenshot({ path: `${out}/${label}-1-menu.png` });
await img.press('Enter');
await page.waitForTimeout(30000);
await page.screenshot({ path: `${out}/${label}-2-deployed.png` });
await page.getByText('Networking', { exact: true }).first().click().catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${label}-3-networking.png` });
const now = execSync(`docker ps --filter ancestor=nginx:alpine --format '{{.Names}}'`).toString().split('\n').filter(Boolean);
const c = now.find(n => !before.has(n));
let report = `new container: ${c}\n`;
const labels = c ? JSON.parse(execSync(`docker inspect ${c} --format '{{json .Config.Labels}}'`).toString()) : {};
const tl = Object.entries(labels).filter(([k]) => k.startsWith('traefik.'));
report += tl.length ? tl.map(([k, v]) => `  ${k}=${v}`).join('\n') + '\n' : '  (no traefik.* labels)\n';
const host = (tl.map(([, v]) => v).join(' ').match(/Host\(`([^`]+)`\)/) || [])[1];
if (host) {
  report += `curl -H "Host: ${host}" http://127.0.0.1/ -> ` + execSync(`curl -s -o /dev/null -w '%{http_code}' -H "Host: ${host}" http://127.0.0.1/`).toString() + '\n';
  const p2 = await ctx.newPage();
  await p2.goto(`http://${host}/`);
  await p2.waitForTimeout(3000);
  await p2.screenshot({ path: `${out}/${label}-4-public-url.png` });
  await p2.close();
} else report += 'no public hostname to open\n';
fs.writeFileSync(`${out}/${label}-routing.txt`, report);
console.log(report);
await ctx.close(); await browser.close();
const v = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); fs.renameSync(`${vdir}/${v}`, `${out}/${label}.webm`); fs.rmSync(vdir, { recursive: true });
