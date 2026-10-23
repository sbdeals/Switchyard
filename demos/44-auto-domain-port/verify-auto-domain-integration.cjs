const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = '/workspace/wt-auto-domain-port/dashboard';
const ts = require(`${root}/node_modules/typescript`);
let assertions = 0;
function equal(actual, expected, label) {
  assert.equal(actual, expected, label);
  assertions++;
}
function load(relative, mocks, globals = {}) {
  const filename = `${root}/src/${relative}`;
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, process: { env: {} }, Error, setTimeout, clearTimeout,
    require(id) {
      if (!(id in mocks)) throw new Error(`Unexpected import: ${id}`);
      return mocks[id];
    },
    ...globals,
  }, { filename });
  return module.exports;
}
const appPort = load('lib/app-port.ts', {});
async function verifyDocker() {
  let inspect = async () => ({ Config: { ExposedPorts: { '8080/tcp': {} } } });
  let inspectedImage;
  class Docker {
    getImage(image) { inspectedImage = image; return { inspect: () => inspect() }; }
  }
  const docker = load('lib/docker.ts', { 'server-only': {}, dockerode: Docker }, {
    process: { env: { DOCKER_OP_TIMEOUT_MS: '5' } },
  });
  equal(JSON.stringify(await docker.readImageExposedPorts('custom/web:latest')), '["8080/tcp"]', 'Read Docker EXPOSE');
  equal(inspectedImage, 'custom/web:latest', 'Inspect exact image reference');
  inspect = async () => ({ Config: {} });
  equal((await docker.readImageExposedPorts('empty')).length, 0, 'No EXPOSE returns empty');
  inspect = async () => { throw new Error('image/daemon unavailable'); };
  equal((await docker.readImageExposedPorts('missing')).length, 0, 'Unavailable image/daemon returns empty');
  inspect = () => new Promise(() => {});
  equal((await docker.readImageExposedPorts('stalled')).length, 0, 'Timeout returns empty');
}
async function verifyDomain({ detail, explicitPort, exposedPorts = [], generated = 'web.203.0.113.9.traefik.me', expectedPort, expectInspect = true, hostIp = '203.0.113.9' }) {
  const calls = [];
  const inspected = [];
  const dokploy = load('lib/dokploy.ts', {
    'server-only': {},
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'test-session' }) }) },
    'next/navigation': { redirect: () => { throw new Error('Unexpected redirect'); } },
    './session': { SESSION_COOKIE: 'session', openSession: () => ({ dokployCookie: 'auth=test' }) },
    './names': {}, './template-volumes': {}, './app-port': appPort,
    './docker': { readImageExposedPorts: async (image) => { inspected.push(image); return exposedPorts; } },
  }, {
    process: { env: { SWITCHYARD_HOST_IP: hostIp } }, AbortSignal,
    fetch: async (url, init) => {
      const endpoint = new URL(url).pathname.split('/').pop();
      calls.push({ endpoint, body: init.body ? JSON.parse(init.body) : null });
      const value = endpoint === 'application.one' ? detail : endpoint === 'domain.generateDomain' ? generated : null;
      return { status: 200, ok: true, text: async () => JSON.stringify(value) };
    },
  });
  const host = await dokploy.ensureAutoDomain('app-id', explicitPort);
  if (!hostIp) {
    equal(host, null, 'Unset host IP is no-op');
    equal(calls.length, 0, 'No requests in no-op mode');
    return;
  }
  if (detail.domains?.length) {
    equal(host, detail.domains[0].host, 'Existing auto-domain reused');
    equal(calls.length, 1, 'Existing auto-domain needs only app lookup');
    equal(inspected.length, 0, 'Existing auto-domain skips inference');
    return;
  }
  const created = calls.find((call) => call.endpoint === 'domain.create').body;
  equal(created.port, expectedPort, 'Resolved port reaches domain.create');
  equal(created.host, host, 'Returned host matches created domain');
  equal(created.certificateType, generated ? 'none' : 'letsencrypt', 'Correct certificate mode');
  equal(inspected.length, expectInspect ? 1 : 0, 'Inspect skipped for explicit or absent image');
}
async function verifyActions() {
  const calls = [];
  const dokploy = {
    createApplication: async (...args) => { calls.push(['create', ...args]); return 'app-id'; },
    setAppDockerSource: async (...args) => { calls.push(['source', ...args]); },
    applicationAction: async (...args) => { calls.push(['deploy', ...args]); },
    ensureAutoDomain: async (...args) => { calls.push(['domain', ...args]); },
  };
  const actions = load('app/actions.ts', {
    'next/cache': { revalidatePath: () => {} }, 'next/navigation': { unstable_rethrow: () => {} },
    '@/lib/dokploy': dokploy, '@/lib/engines': {}, '@/lib/names': {}, '@/lib/app-port': appPort,
  });
  let result = await actions.quickDeployImageAction('custom/web', 'Web', 'env-id', '65536');
  equal(result.ok, false, 'Invalid override reported as failure');
  equal(calls.length, 0, 'Invalid override creates no application');
  result = await actions.quickDeployImageAction(' custom/web ', 'Web', 'env-id', '8080');
  equal(result.ok, true, 'Explicit port deployment succeeds');
  equal(calls.find((call) => call[0] === 'domain')[2], 8080, 'Override reaches ensureAutoDomain');
  equal(calls.find((call) => call[0] === 'source')[2], 'custom/web', 'Trimmed image reaches Docker source');
  calls.length = 0;
  result = await actions.quickDeployImageAction('custom/web', 'Web', 'env-id', '');
  equal(result.ok, true, 'Auto port deployment succeeds');
  equal(calls.find((call) => call[0] === 'domain')[2], undefined, 'Empty port enables inference');
}
(async () => {
  await verifyDocker();
  const detail = { appName: 'web', dockerImage: 'custom/web:latest', env: 'PORT=5000', domains: [] };
  await verifyDomain({ detail, exposedPorts: ['8080/tcp'], expectedPort: 5000 });
  await verifyDomain({ detail, exposedPorts: ['8080/tcp'], explicitPort: 80, expectedPort: 80, expectInspect: false });
  await verifyDomain({ detail: { ...detail, dockerImage: 'nginx:alpine' }, expectedPort: 5000 });
  await verifyDomain({ detail: { ...detail, env: null }, exposedPorts: ['8080/tcp'], expectedPort: 8080 });
  await verifyDomain({ detail: { ...detail, dockerImage: 'nginx:alpine', env: null }, expectedPort: 80 });
  await verifyDomain({ detail: { ...detail, env: 'PORT=invalid' }, exposedPorts: ['8080/tcp'], expectedPort: 8080 });
  await verifyDomain({ detail: { ...detail, dockerImage: 'nginx:alpine', env: 'PORT=65536' }, expectedPort: 80 });
  await verifyDomain({ detail, expectedPort: 5000, generated: null });
  await verifyDomain({ detail: { ...detail, dockerImage: null, env: null }, expectedPort: 3000, expectInspect: false });
  await verifyDomain({ detail: { ...detail, domains: [{ host: 'existing.203.0.113.9.sslip.io' }] } });
  await verifyDomain({ detail, hostIp: '' });
  await verifyActions();
  console.log(`PASS: ${assertions} mocked integration assertions; no network or Docker daemon required.`);
  console.log('Verified Docker EXPOSE and failure/timeout fallback; env PORT precedence; absent/invalid-env fallback; both domain host branches; explicit override propagation and validation before creation; auto-domain reuse and no-op mode.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
