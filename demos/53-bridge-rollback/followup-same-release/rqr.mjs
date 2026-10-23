// Round Q (#53) part 2: one explicit Redeploy on the app from rq.mjs -> exactly one rollback-history entry.
import { login, open } from './lib.mjs'; import fs from 'fs'; import { execSync } from 'child_process';
const [out, APP] = process.argv.slice(2);
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); } catch (e) { return (e.stdout||'').toString().trim() || `ERR ${e.status}`; } };
const vdir = `${out}/video-redeploy`; const { browser, ctx, page } = await open({ video: vdir });
let r = `## [redeploy] explicit Redeploy of ${APP} — ${sh('date "+%H:%M:%S %Z"')}\n`; const log = (s) => { r += s + '\n'; console.log(s); };
const cf = `/etc/dokploy/compose/${APP}/code/docker-compose.yml`;
const deps = () => sh(`docker exec dokploy-postgres psql -U dokploy -d dokploy -At -F ' | ' -c "select to_char(d.\\"createdAt\\"::timestamptz at time zone 'America/New_York','HH24:MI:SS') || ' EDT', d.title, d.status from deployment d join compose c on c.\\"composeId\\"=d.\\"composeId\\" where c.\\"appName\\"='${APP}' order by d.\\"createdAt\\""`);
await login(page); await page.waitForTimeout(2000);
await page.getByText(APP.replace(/-[a-z0-9]+$/, ''), { exact: false }).first().click(); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Redeploy' }).first().click(); await page.waitForTimeout(1500);
const confirm = page.getByRole('button', { name: /^Redeploy$/ }).last(); if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
for (let i = 0; i < 40; i++) { await page.waitForTimeout(3000); const d = deps(); if (d.split('\n').length >= 3 && !/running|queued/.test(d)) break; }
log(`Dokploy deployments (oldest first):\n${deps()}`);
log(`\nx-switchyard history after one explicit Redeploy:\n${sh(`sed -n '/^  history:/,/^[a-z]/p' ${cf} | grep -v '^services:'`)}`);
log(`history entries: ${sh(`grep -c '^    - ' <(sed -n '/^  history:/,/^[a-z]/p' ${cf})`)}`);
await page.reload(); await page.waitForTimeout(2500);
await page.getByText(APP.replace(/-[a-z0-9]+$/, ''), { exact: false }).first().click().catch(() => {}); await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/redeploy-1-overview-one-history-entry.png` });
fs.writeFileSync(`${out}/redeploy-result.txt`, r);
await ctx.close(); await browser.close();
const w = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
execSync(`ffmpeg -loglevel error -y -i ${vdir}/${w} -c:v libx264 -pix_fmt yuv420p ${out}/redeploy.mp4`); fs.rmSync(vdir, { recursive: true });
