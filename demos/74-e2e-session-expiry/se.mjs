// Session-expiry demo: draft in Variables, then expire session 3 ways, click Save.
import { open, login } from './lib.mjs';
import fs from 'fs'; import { execSync } from 'child_process';
const [label, out] = process.argv.slice(2); const APP = process.env.APP || 'nginx-g9se';
fs.mkdirSync(out, { recursive: true });
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
const { browser, ctx, page } = await open({ video: vdir });
const log = [];
const card = async (t) => { await page.setContent(`<body style="background:#0b0b10;color:#e5e5e5;font:22px ui-monospace,monospace;padding:40px"><h2 style="color:#a78bfa">[${label}]</h2><p>${t}</p></body>`); await page.waitForTimeout(2500); };
async function scenario(n, title, expire) {
  await card(`Scenario ${n}: ${title}`);
  await login(page); await page.waitForTimeout(1500);
  await page.getByText(APP, { exact: true }).first().click(); await page.waitForTimeout(1200);
  await page.getByRole('tab', { name: 'Variables' }).click(); await page.waitForTimeout(800);
  const ta = page.getByLabel('Environment variables, one KEY=value per line');
  await ta.fill(`DRAFT_${n}=keep-me-please\nLOG_LEVEL=debug`); await page.waitForTimeout(800);
  await expire();
  await page.getByRole('button', { name: 'Save variables' }).click(); await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${label}-s${n}.png` });
  const url = page.url(); const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const draft = await page.getByLabel('Environment variables, one KEY=value per line').inputValue({ timeout: 1500 }).catch(() => '(editor gone)');
  log.push(`--- scenario ${n}: ${title}\nurl: ${url}\ndraft after Save: ${JSON.stringify(draft)}\nbanner/err text: ${(body.match(/(session[^.]*\.|couldn.t load[^.]*|Application error[^.]*|Sign in[^.]*)/i) || ['(none)'])[0]}`);
  // follow sign-in path if offered
  if (n === 3) {
    const gErr = await page.goto(process.env.BASE + '/').then(() => '').catch(e => e.message.split('\n')[0]); await page.waitForTimeout(3000); if (gErr) { log.push('navigate to / after revoke -> ' + gErr); await card('Browser: ' + gErr); }
    const u2 = page.url(); const b2 = (await page.locator('body').innerText()).slice(0, 200).replace(/\s+/g, ' ');
    await page.screenshot({ path: `${out}/${label}-s3-after-nav.png` });
    log.push(`navigate to / after revoke -> ${u2} :: ${b2}`);
  }
  await ctx.clearCookies();
}
await scenario(1, 'switchyard_session cookie deleted', async () => {
  const keep = (await ctx.cookies()).filter(c => c.name !== 'switchyard_session'); await ctx.clearCookies(); await ctx.addCookies(keep); });
await scenario(2, 'switchyard_session cookie replaced with garbage', async () => {
  const cs = await ctx.cookies(); await ctx.clearCookies(); await ctx.addCookies(cs.map(c => c.name === 'switchyard_session' ? { ...c, value: 'garbage.' + c.value.slice(5, 30) } : c)); });
await scenario(3, 'Dokploy session revoked server-side (sealed cookie still valid)', async () => {
  execSync(`sudo docker exec dokploy-postgres psql -U dokploy -d dokploy -Atc 'delete from session where id = (select id from session order by created_at desc limit 1)'`); });
await ctx.close(); await browser.close();
const v = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); fs.renameSync(`${vdir}/${v}`, `${out}/${label}.webm`); fs.rmSync(vdir, { recursive: true });
execSync(`ffmpeg -loglevel error -y -i ${out}/${label}.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${out}/${label}.mp4 && rm ${out}/${label}.webm`);
fs.writeFileSync(`${out}/${label}.txt`, log.join('\n') + '\n'); console.log(log.join('\n'));
