// Volumes tab demo for compose-backed services (declared compose volumes).
import { open, login } from './lib.mjs';
import fs from 'fs'; import { execSync } from 'child_process';
const [label, out, ...apps] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
const { browser, ctx, page } = await open({ video: vdir });
const log = [];
await login(page); await page.waitForTimeout(1500);
for (const app of apps) {
  await page.goto(process.env.BASE + '/'); await page.waitForTimeout(1500);
  await page.getByText(app, { exact: true }).first().click(); await page.waitForTimeout(1200);
  await page.getByRole('tab', { name: 'Volumes' }).click(); await page.waitForTimeout(2500);
  const panel = (await page.locator('[role=tabpanel]').last().innerText().catch(() => page.locator('[role=dialog]').last().innerText()));
  log.push(`--- ${app} → Volumes\n${panel.trim()}`);
  await page.screenshot({ path: `${out}/${label}-${app}.png` });
}
await ctx.close(); await browser.close();
const v = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); fs.renameSync(`${vdir}/${v}`, `${out}/${label}.webm`); fs.rmSync(vdir, { recursive: true });
execSync(`ffmpeg -loglevel error -y -i ${out}/${label}.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${out}/${label}.mp4 && rm ${out}/${label}.webm`);
fs.writeFileSync(`${out}/${label}.txt`, log.join('\n') + '\n'); console.log(log.join('\n'));
