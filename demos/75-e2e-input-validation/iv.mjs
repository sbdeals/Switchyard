// Input validation demo: env fixture, port 70000, bad cron, L cron, bad mount path.
import { open, login } from './lib.mjs';
import fs from 'fs'; import { execSync } from 'child_process';
const [label, out] = process.argv.slice(2); const APP = process.env.APP || 'nginx-g9se';
fs.mkdirSync(out, { recursive: true });
const vdir = `${out}/video-${label}`; fs.rmSync(vdir, { recursive: true, force: true });
const { browser, ctx, page } = await open({ video: vdir });
const log = []; const drawer = () => page.locator('[role=dialog]').last();
const lines = async () => (await drawer().innerText().catch(() => '')).split('\n').map(s => s.trim()).filter(Boolean);
async function act(name, fn, shot) {
  const b = new Set(await lines()); await fn(); await page.waitForTimeout(3500);
  const n = (await lines()).filter(l => !b.has(l));
  log.push(`--- ${name}\nnew text: ${JSON.stringify(n.slice(0, 8))}`);
  if (page.url().includes('chrome-error') || (await page.locator('body').innerText()).includes("couldn")) log.push('PAGE ERROR');
  await page.screenshot({ path: `${out}/${label}-${shot}.png` });
}
const tab = async (t) => { await page.getByRole('tab', { name: t }).click(); await page.waitForTimeout(1000); };
await login(page); await page.waitForTimeout(1500);
await page.getByText(APP, { exact: true }).first().click(); await page.waitForTimeout(1200);
await tab('Variables');
const ta = page.getByLabel(/^Environment variables/);
const fixture = fs.readFileSync('/tmp/switchyard-d-fix-1-env-fixture.txt', 'utf8');
await act('env: paste fixture (export, dotted, dashed, multiline quoted, duplicate)', async () => { await ta.fill(fixture); await page.getByRole('button', { name: 'Save variables' }).click(); }, 'env-fixture');
await act('env: add bare line BROKEN_LINE', async () => { await ta.fill(fixture + 'BROKEN_LINE\n'); await page.getByRole('button', { name: 'Save variables' }).click(); }, 'env-broken');
await ta.fill(''); await page.getByRole('button', { name: 'Save variables' }).click(); await page.waitForTimeout(2500);
await tab('Networking');
await act('port: published 70000 -> 80', async () => { await page.getByPlaceholder('8080').fill('70000'); await page.getByPlaceholder('80', { exact: true }).fill('80'); await page.getByPlaceholder('8080').locator('xpath=ancestor::*[.//button[normalize-space()="Add"]][1]').getByRole('button', { name: 'Add', exact: true }).click(); }, 'port-70000');
await tab('Schedules');
await act('cron: "not-a-cron"', async () => { await page.getByPlaceholder('nightly-backup').fill('demo-bad'); await page.getByPlaceholder('0 3 * * *').fill('not-a-cron'); await page.getByPlaceholder('node scripts/cleanup.js').fill('echo hi'); await page.getByRole('button', { name: 'Create' }).click(); }, 'cron-bad');
await act('cron: "0 0 L * *" (last day of month)', async () => { await page.getByPlaceholder('nightly-backup').fill('demo-lastday'); await page.getByPlaceholder('0 3 * * *').fill('0 0 L * *'); await page.getByPlaceholder('node scripts/cleanup.js').fill('echo hi'); await page.getByRole('button', { name: 'Create' }).click(); }, 'cron-L');
await tab('Volumes');
await page.getByRole('button', { name: 'Add mount' }).first().click(); await page.waitForTimeout(800);
await act('mount: volume "my data" at relative path "data"', async () => { await page.getByPlaceholder('my-data').fill('my data'); await page.getByPlaceholder('/data').fill('data'); await page.getByRole('button', { name: 'Add mount' }).last().click(); }, 'mount-bad');
await ctx.close(); await browser.close();
const v = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); fs.renameSync(`${vdir}/${v}`, `${out}/${label}.webm`); fs.rmSync(vdir, { recursive: true });
execSync(`ffmpeg -loglevel error -y -i ${out}/${label}.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${out}/${label}.mp4 && rm ${out}/${label}.webm`);
const db = execSync(`sudo docker exec dokploy-postgres psql -U dokploy -d dokploy -Atc "select a.env, '|ports:', (select string_agg(\\"publishedPort\\"::text, ',') from port p where p.\\"applicationId\\"=a.\\"applicationId\\"), '|sched:', (select string_agg(s.name||' '||s.\\"cronExpression\\", ',') from schedule s where s.\\"applicationId\\"=a.\\"applicationId\\"), '|mounts:', (select string_agg(m.\\"mountPath\\", ',') from mount m where m.\\"applicationId\\"=a.\\"applicationId\\") from application a where a.name='${APP}'"`).toString();
log.push('--- Dokploy DB state after run\n' + db);
fs.writeFileSync(`${out}/${label}.txt`, log.join('\n') + '\n'); console.log(log.join('\n'));
