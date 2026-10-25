import { open, BASE, PASS } from './lib.mjs'; import fs from 'fs';
const MPW = fs.readFileSync(new URL('./.onboard-pass', import.meta.url).pathname, 'utf8').trim();
for (const [email, pw, who] of [['admin@switchyard.local', PASS, 'admin'], ['b1-member@switchyard.local', MPW, 'member']]) {
  const { browser, page } = await open();
  await page.goto(BASE + '/login'); await page.fill('input[name=email]', email); await page.fill('input[name=password]', pw);
  await page.locator('button[type=submit]').first().click(); await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await page.getByRole('button', { name: 'Open agent' }).first().click(); await page.waitForTimeout(1500);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${process.env.OUT}/${process.env.LABEL}-${who}-agent-panel.png` });
  console.log(who, (await page.locator('aside, [role=dialog]').last().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300));
  await browser.close();
}
