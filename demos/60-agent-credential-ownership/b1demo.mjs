// B1 (S-P0-3) demo: admin vs member against /api/agent/config. Usage: BASE=http://127.0.0.1:3002 LABEL=before node b1demo.mjs
import { open, BASE, PASS } from './lib.mjs'; import fs from 'fs';
const MPW = fs.readFileSync(new URL('./.onboard-pass', import.meta.url).pathname, 'utf8').trim();
const users = [['admin@switchyard.local', PASS, 'admin(owner)'], ['b1-member@switchyard.local', MPW, 'member']];
const SHOT = process.env.SHOT;
for (const [email, pw, who] of users) {
  const { browser, page } = await open();
  await page.goto(BASE + '/login'); await page.fill('input[name=email]', email); await page.fill('input[name=password]', pw);
  await page.locator('button[type=submit]').first().click(); await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 });
  const call = (m, b) => page.evaluate(async ([m, b]) => { const r = await fetch('/api/agent/config', { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); return { s: r.status, canConfigure: j.canConfigure, configured: j.configured, provider: j.provider, baseUrl: j.baseUrl, error: j.error }; }, [m, b]);
  const show = (t, r) => console.log(`[${who}] ${t.padEnd(52)} -> HTTP ${r.s}${r.error ? '  error: ' + r.error : ''}${r.canConfigure !== undefined ? '  canConfigure=' + r.canConfigure : ''}${r.configured !== undefined ? '  configured=' + r.configured : ''}${r.baseUrl !== undefined ? '  baseUrl=' + r.baseUrl : ''}`);
  show('GET  /api/agent/config', await call('GET'));
  if (who === 'member') {
    show('POST {provider:"openai", baseUrl:"https://evil.invalid/v1"}', await call('POST', { provider: 'openai', baseUrl: 'https://evil.invalid/v1' }));
    show('POST {key:"sk-member-planted-0000"}', await call('POST', { key: 'sk-member-planted-0000' }));
    if (SHOT) { await page.goto(BASE + '/'); await page.waitForTimeout(2500); await page.screenshot({ path: SHOT + '-member-home.png' }); }
  } else {
    show('POST {provider:"openai", baseUrl:"http://127.0.0.1:9/v1", key}', await call('POST', { provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1', key: 'sk-demo-fake-00000000' }));
    show('POST {baseUrl:"https://other.invalid/v1"} (no new key)', await call('POST', { baseUrl: 'https://other.invalid/v1' }));
    show('POST {baseUrl:"http://plain.invalid/v1"}', await call('POST', { baseUrl: 'http://plain.invalid/v1' }));
    show('POST {clear:true} + reset', await call('POST', { clear: true }));
  }
  await browser.close();
}
