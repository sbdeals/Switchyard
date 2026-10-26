const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const desktopRoot = "/workspace/wt-desktop-origin-boundary/desktop";
const ts = require(join(desktopRoot, "node_modules/typescript"));
const statusPath = join(desktopRoot, "dist/index.html");
const statusUrl = pathToFileURL(statusPath).href;
const dashboardUrl = "http://127.0.0.1:3001";
let checks = 0;

function equal(actual, expected, label) {
  assert.equal(actual, expected, label);
  checks++;
}

function loadTs(relativePath, dependencies = {}, globals = {}) {
  const filename = join(desktopRoot, relativePath);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    __dirname: join(desktopRoot, "dist"),
    URL,
    process: { env: {}, argv: ["node", "switchyard"], platform: process.platform },
    require(specifier) {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      if (specifier === "node:path" || specifier === "node:url") return require(specifier);
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
    ...globals,
  }, { filename });
  return module.exports;
}

const policy = loadTs("src/main/url-policy.ts");
const navigationCases = [
  ["exact origin", dashboardUrl, "allow"],
  ["dashboard route/query/fragment", `${dashboardUrl}/projects?tab=builds#logs`, "allow"],
  ["port prefix", "http://127.0.0.1:30010", "external"],
  ["userinfo trick", "http://127.0.0.1:3001@evil", "deny"],
  ["userinfo on trusted origin", "http://user:pass@127.0.0.1:3001", "deny"],
  ["different scheme", "https://127.0.0.1:3001", "external"],
  ["different host", "http://localhost:3001", "external"],
  ["localhost port prefix", "http://localhost:30010", "external"],
  ["localhost different port", "http://localhost:3010", "external"],
  ["IPv6 loopback", "http://[::1]:3001", "external"],
  ["hostname suffix", "http://127.0.0.1.evil.invalid:3001", "external"],
  ["external HTTPS", "https://example.invalid/app", "external"],
  ["bundled status", statusUrl, "allow"],
  ["other file", pathToFileURL("/tmp/untrusted.html").href, "deny"],
  ["file suffix", `${statusUrl}.evil`, "deny"],
  ["file query", `${statusUrl}?next=https://example.invalid`, "deny"],
  ["file fragment", `${statusUrl}#status`, "deny"],
  ["empty file query", `${statusUrl}?`, "deny"],
  ["empty file fragment", `${statusUrl}#`, "deny"],
  ["file trailing slash", `${statusUrl}/`, "deny"],
  ["remote file host", statusUrl.replace("file:///", "file://evil.invalid/"), "deny"],
  ["encoded path separator", statusUrl.replace("index.html", "..%2findex.html"), "deny"],
  ["traversal to other file", statusUrl.replace("index.html", "../untrusted.html"), "deny"],
  ["malformed", "http://[", "deny"],
  ["relative URL", "/index.html", "deny"],
  ["blank page", "about:blank", "deny"],
  ["JavaScript URL", "javascript:alert(1)", "deny"],
  ["data document", "data:text/html,hello", "deny"],
  ["blob sharing dashboard origin", `blob:${dashboardUrl}/id`, "deny"],
  ["custom protocol", "switchyard://open", "deny"],
  ["mailto", "mailto:test@example.invalid", "deny"],
];
const permissions = ["clipboard-sanitized-write", "clipboard-read", "clipboard-write", "media",
  "geolocation", "notifications", "openExternal", "unknown"];

async function main() {
  for (const [label, url, expected] of navigationCases) {
    equal(policy.navigationDecision(url, statusPath, dashboardUrl), expected, label);
    for (const permission of permissions) {
      equal(policy.permissionDecision(permission, url, statusPath, dashboardUrl),
        permission === "clipboard-sanitized-write" && expected === "allow",
        `${permission}: ${label}`);
    }
  }
  for (const missingOrInvalid of [undefined, "", "not a URL", `blob:${dashboardUrl}/id`,
    "file:///tmp/index.html", "http://user@127.0.0.1:3001"]) {
    equal(policy.navigationDecision(dashboardUrl, statusPath, missingOrInvalid), "external",
      `untrusted dashboard setting: ${missingOrInvalid}`);
    equal(policy.navigationDecision(statusUrl, statusPath, missingOrInvalid), "allow",
      "status remains available without a dashboard");
    equal(policy.permissionDecision("clipboard-sanitized-write", dashboardUrl, statusPath,
      missingOrInvalid), false, "dashboard clipboard requires an active trusted origin");
    equal(policy.permissionDecision("clipboard-sanitized-write", statusUrl, statusPath,
      missingOrInvalid), true, "status clipboard remains available without a dashboard");
  }
  equal(policy.navigationDecision("http://example.invalid:80/path", statusPath,
    "http://example.invalid"), "allow", "normalized HTTP default port");
  equal(policy.navigationDecision("https://example.invalid:443/path", statusPath,
    "https://example.invalid"), "allow", "normalized HTTPS default port");
  equal(policy.navigationDecision(`${dashboardUrl}/route`, statusPath,
    `${dashboardUrl}/other-route`), "allow", "compare origins, not paths");
  equal(policy.navigationDecision("http://localhost:3001", statusPath,
    "http://localhost:3001"), "allow", "exact localhost origin if explicitly configured");
  for (const url of ["http://localhost:30010", "http://localhost:3010"]) {
    equal(policy.navigationDecision(url, statusPath, "http://localhost:3001"), "external",
      "localhost origin still requires the exact port");
    equal(policy.permissionDecision("clipboard-sanitized-write", url, statusPath,
      "http://localhost:3001"), false, "clipboard cannot cross localhost ports");
  }
  equal(policy.isStatusViewUrl(statusUrl, join(desktopRoot, "dist/sub/../index.html")), true,
    "resolve bundled path before comparison");
  const specialPath = "/tmp/Switchyard test #1/index.html";
  equal(policy.isStatusViewUrl(pathToFileURL(specialPath).href, specialPath), true,
    "encoded characters in a canonical bundled path");

  const trustedFrame = { url: statusUrl };
  equal(policy.isTrustedIpcSender(trustedFrame, trustedFrame, statusPath), true,
    "bundled main frame IPC");
  equal(policy.isTrustedIpcSender({ url: statusUrl }, trustedFrame, statusPath), false,
    "subframe with identical URL is rejected");
  equal(policy.isTrustedIpcSender(null, trustedFrame, statusPath), false, "detached sender");
  equal(policy.isTrustedIpcSender(trustedFrame, undefined, statusPath), false, "missing window");
  for (const url of [dashboardUrl, `${statusUrl}#`, "file:///tmp/untrusted.html", "about:blank"]) {
    const frame = { url };
    equal(policy.isTrustedIpcSender(frame, frame, statusPath), false,
      `untrusted main frame: ${url}`);
  }

  // Run the real main module against inert Electron/orchestrator doubles. No GUI,
  // shell, config, credential, Docker, filesystem mutation, or network is available.
  const handlers = new Map();
  const ipc = new Map();
  const opened = [];
  const actions = [];
  const loaded = [];
  const orchestratorHandlers = new Map();
  const cookieUrls = [];
  const snapshot = { phase: "ready", dashboardUrl };
  const fixtureConfig = {
    dashboardPort: 3001,
    dokployPort: 3000,
    adminEmail: "fixture@example.invalid",
    adminPassword: "test-only-password",
    sessionSecret: "test-only-session-secret",
  };
  const noop = () => {};
  const autologin = loadTs("src/main/autologin.ts", {
    "node:crypto": require("node:crypto"),
    "./logging.js": { log: noop },
  }, {
    Buffer,
    AbortSignal,
    fetch: async (url) => {
      equal(url, "http://localhost:3000/api/auth/sign-in/email", "sign-in hits only the fetch stub");
      return { ok: true, headers: { getSetCookie: () => ["fixture_session=test-only; Path=/"] } };
    },
  });
  const fakeSession = { cookies: { set: async ({ url }) => { cookieUrls.push(url); } } };
  let fakeWindow;
  let popupHandler;
  let permissionCheck;
  let permissionRequest;
  class BrowserWindow {
    constructor() {
      fakeWindow = this;
      this.webContents = {
        mainFrame: { url: statusUrl },
        getURL: () => this.webContents.mainFrame.url,
        on: (event, handler) => handlers.set(event, handler),
        setWindowOpenHandler: (handler) => { popupHandler = handler; },
        session: {
          setPermissionCheckHandler: (handler) => { permissionCheck = handler; },
          setPermissionRequestHandler: (handler) => { permissionRequest = handler; },
        },
      };
    }
    on() {}
    async loadFile(file) { equal(file, statusPath, "window loads canonical bundled file"); }
    async loadURL(url) {
      loaded.push(url);
      this.webContents.mainFrame.url = url;
    }
  }
  class Orchestrator {
    on(event, handler) { orchestratorHandlers.set(event, handler); }
    snapshot() { return snapshot; }
    async run() {}
    async handleAction(id, payload) { actions.push({ id, payload }); }
  }
  loadTs("src/main/index.ts", {
    electron: {
      app: {
        on: noop,
        requestSingleInstanceLock: () => true,
        whenReady: async () => {},
        setAppUserModelId: noop,
        getLoginItemSettings: () => ({ wasOpenedAtLogin: false }),
        isPackaged: false,
      },
      BrowserWindow,
      ipcMain: { handle: (name, handler) => ipc.set(name, handler) },
      shell: { openExternal: async (url) => { opened.push(url); } },
      session: { defaultSession: fakeSession },
    },
    "./autologin.js": autologin,
    "./logging.js": { initLogging: noop, log: noop },
    "./orchestrator.js": { Orchestrator },
    "./prereqs.js": {
      augmentPath: noop,
      DOCKER_LICENSE_URL: "https://example.invalid/license",
      DOCKER_INSTALL_DOCS_URL: "https://example.invalid/docs",
    },
    "./settings.js": { loadSettings: () => ({ openAtLogin: false }), saveSettings: noop },
    "./tray.js": { createTray: noop, refreshTray: noop },
    "./updater.js": { initUpdater: noop, checkForUpdatesInteractive: noop },
    "./url-policy.js": policy,
  });
  await new Promise(setImmediate);

  for (const name of ["will-navigate", "will-redirect"]) {
    equal(typeof handlers.get(name), "function", `${name} is guarded`);
    for (const [label, url, expected] of navigationCases) {
      let prevented = false;
      opened.length = 0;
      handlers.get(name)({ preventDefault: () => { prevented = true; } }, url);
      equal(prevented, expected !== "allow", `${name}: ${label}`);
      equal(opened.length, expected === "external" ? 1 : 0, `${name} external: ${label}`);
      if (opened.length) equal(opened[0], url, `${name} external target: ${label}`);
    }
  }

  for (const [label, url, expected] of navigationCases) {
    opened.length = 0;
    equal(popupHandler({ url }).action, "deny", `deny popup: ${label}`);
    const shouldOpen = expected === "external" || (expected === "allow" && url !== statusUrl);
    equal(opened.length, shouldOpen ? 1 : 0, `popup external: ${label}`);
    if (opened.length) equal(opened[0], url, `popup target: ${label}`);
  }

  for (const [label, url, decision] of navigationCases) {
    for (const permission of permissions) {
      const expected = permission === "clipboard-sanitized-write" && decision === "allow";
      equal(permissionCheck(fakeWindow.webContents, permission, url, {
        requestingUrl: url, isMainFrame: true,
      }), expected, `permission check: ${permission}, ${label}`);
      let calls = 0;
      permissionRequest(fakeWindow.webContents, permission, (allowed) => {
        calls++;
        equal(allowed, expected, `permission request: ${permission}, ${label}`);
      }, { requestingUrl: url, isMainFrame: true });
      equal(calls, 1, "permission callback resolves once");
    }
  }
  equal(permissionCheck(null, "geolocation", dashboardUrl, { isMainFrame: false }),
    false, "permission checks without webContents deny");

  const clipboard = "clipboard-sanitized-write";
  const permissionFallbackCases = [
    ["requesting origin", dashboardUrl, { isMainFrame: true }, true],
    ["main frame fallback", "", { isMainFrame: true }, true],
    ["bundled file origin fallback", "file://", { isMainFrame: true }, true],
    ["explicit foreign origin", "https://example.invalid", { isMainFrame: true }, false],
    ["cross-origin subframe", "https://example.invalid", { isMainFrame: false }, false],
    ["unidentified subframe", "", { isMainFrame: false }, false],
    ["unknown file subframe", "file://", { isMainFrame: false }, false],
    ["explicit untrusted frame URL", dashboardUrl,
      { requestingUrl: "https://example.invalid", isMainFrame: true }, false],
    ["explicit other file", "file://",
      { requestingUrl: "file:///tmp/untrusted.html", isMainFrame: true }, false],
    ["opaque origin", "null", { isMainFrame: true }, false],
  ];
  for (const [label, origin, details, expected] of permissionFallbackCases) {
    equal(permissionCheck(fakeWindow.webContents, clipboard, origin, details), expected,
      `clipboard permission source: ${label}`);
  }
  equal(permissionCheck(null, clipboard, "file://", { isMainFrame: true }), false,
    "missing webContents cannot resolve a file origin");
  equal(permissionCheck(null, clipboard, "", { isMainFrame: true }), false,
    "missing permission identity denies clipboard");
  for (const [details, expected] of [
    [{ requestingUrl: "", isMainFrame: true }, true],
    [{ requestingUrl: "", isMainFrame: false }, false],
    [{ requestingUrl: "https://example.invalid", isMainFrame: true }, false],
    [{ requestingUrl: "file:///tmp/untrusted.html", isMainFrame: true }, false],
  ]) {
    let calls = 0;
    permissionRequest(fakeWindow.webContents, clipboard, (allowed) => {
      calls++;
      equal(allowed, expected, "permission request URL/fallback respects the requesting frame");
    }, details);
    equal(calls, 1, "permission request fallback resolves once");
  }

  const mainFrame = fakeWindow.webContents.mainFrame;
  equal(ipc.get("getState")({ senderFrame: mainFrame }), snapshot, "main frame gets state");
  await ipc.get("action")({ senderFrame: mainFrame }, "resetAll");
  equal(actions.length, 1, "bundled main frame can dispatch resetAll to the inert mock");
  equal(actions[0].id, "resetAll", "authorized action is preserved");
  await ipc.get("action")({ senderFrame: mainFrame }, { invalid: "action id" });
  equal(actions.length, 1, "invalid action id is ignored");

  for (const senderFrame of [null, { url: statusUrl }, { url: "file:///tmp/untrusted.html" },
    { url: dashboardUrl }]) {
    equal(ipc.get("getState")({ senderFrame }), null, "reject foreign/detached/subframe state request");
    await ipc.get("action")({ senderFrame }, "resetAll");
    equal(actions.length, 1, "reject foreign/detached/subframe privileged action");
  }
  for (const url of [dashboardUrl, `${statusUrl}?`, `${statusUrl}#`, "file:///tmp/untrusted.html"]) {
    mainFrame.url = url;
    equal(ipc.get("getState")({ senderFrame: mainFrame }), null, `main-frame state denied: ${url}`);
    await ipc.get("action")({ senderFrame: mainFrame }, "resetAll");
    equal(actions.length, 1, `main-frame action denied: ${url}`);
  }

  // Exercise the actual main-process ready handoff and autologin cookie URL with
  // fabricated credentials and a fake fetch. The orchestrator's sole dashboard
  // assignment was also reviewed: it uses this exact 127.0.0.1 origin template.
  for (const port of [3001, 3010]) {
    fixtureConfig.dashboardPort = port;
    snapshot.dashboardUrl = `http://127.0.0.1:${port}`;
    orchestratorHandlers.get("ready")({ cfg: fixtureConfig, dashboardUrl: snapshot.dashboardUrl });
    await new Promise(setImmediate);
    equal(loaded.at(-1), snapshot.dashboardUrl, "window loads the snapshot dashboard origin");
    equal(cookieUrls.at(-1), loaded.at(-1), "autologin cookie URL matches the loaded URL");
    equal(permissionCheck(fakeWindow.webContents, clipboard, snapshot.dashboardUrl,
      { requestingUrl: loaded.at(-1), isMainFrame: true }), true,
      "Copy is allowed at the loaded dashboard origin");
    equal(permissionCheck(fakeWindow.webContents, clipboard, "", { isMainFrame: true }), true,
      "dashboard main-frame fallback allows Copy");
    equal(permissionCheck(fakeWindow.webContents, clipboard, "http://localhost:30010",
      { isMainFrame: true }), false, "trusted window cannot bless a foreign localhost port");
  }

  // The active origin must follow a changed/cleared orchestrator snapshot.
  snapshot.dashboardUrl = "http://127.0.0.1:3010";
  let prevented = false;
  handlers.get("will-navigate")({ preventDefault: () => { prevented = true; } }, dashboardUrl);
  equal(prevented, true, "old dashboard origin rejected after port change");
  prevented = false;
  handlers.get("will-navigate")({ preventDefault: () => { prevented = true; } }, snapshot.dashboardUrl);
  equal(prevented, false, "new dashboard origin allowed");
  snapshot.dashboardUrl = undefined;
  prevented = false;
  handlers.get("will-redirect")({ preventDefault: () => { prevented = true; } }, dashboardUrl);
  equal(prevented, true, "dashboard redirect rejected while no dashboard is active");

  console.log(`PASS: ${checks} URL policy, navigation/redirect/popup, permission, and IPC assertions`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
