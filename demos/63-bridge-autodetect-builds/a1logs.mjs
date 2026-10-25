// A: capture live build logs streaming during a Redeploy of an auto-detected app. usage: BASE=... node a1logs.mjs <serviceName> <out.png>
import { open, login } from './lib.mjs';
const [name, shot] = process.argv.slice(2);
const { browser, page } = await open();
await login(page); await page.waitForTimeout(2500);
await page.getByText(name, { exact: true }).first().click(); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Redeploy' }).first().click(); await page.waitForTimeout(1500);
const confirm = page.getByRole('dialog').getByRole('button', { name: /redeploy|deploy/i }); if (await confirm.count()) await confirm.first().click();
await page.getByRole('tab', { name: 'Deploys' }).click(); 
for (const s of [8, 16]) { await page.waitForTimeout(8000); await page.screenshot({ path: shot.replace('.png', `-${s}s.png`) }); }
console.log((await page.locator('body').innerText()).split('\n').filter(l => /#\d+ |dockerfile|npm|pip|go build|nginx|Building|Step/i.test(l)).slice(0, 12).join('\n'));
await browser.close();
