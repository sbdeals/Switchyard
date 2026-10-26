// Throwaway verifier: loads this worktree's real TypeScript with fake Docker,
// Electron, config, logging, and startup dependencies. No sockets or containers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const root = "/workspace/wt-desktop-stop-reset";
const ts = require(path.join(root, "dashboard/node_modules/typescript"));

const controlPlane = [
  ...["switchyard", "switchyard-traefik", "dokploy-traefik"].map((name) => ({ kind: "container", name })),
  ...["dokploy", "dokploy-postgres", "dokploy-redis", "switchyard-metrics"].map((name) => ({ kind: "service", name })),
  { kind: "network", name: "dokploy-network" },
  ...["dokploy_postgres_password", "dokploy_auth_secret"].map((name) => ({ kind: "secret", name })),
  ...["dokploy", "dokploy-postgres", "dokploy-redis", "switchyard-metrics"].map((name) => ({ kind: "volume", name })),
];
const workloads = [
  { kind: "container", name: "plain-app", labels: {} },
  { kind: "container", name: "compose-db", labels: { "com.docker.compose.project": "demo" } },
  { kind: "container", name: "network-member", labels: {}, networks: ["dokploy-network"] },
  { kind: "service", name: "demo-swarm-app" },
  { kind: "volume", name: "demo-db-data", labels: { "com.docker.compose.project": "demo" } },
  { kind: "volume", name: "external-volume", labels: {} },
];
const serial = (value) => JSON.parse(JSON.stringify(value));

function harness({ failKind, response = 1 } = {}) {
  const state = {
    remaining: structuredClone([...controlPlane, ...workloads]),
    calls: [], logs: [], saved: [], dialogs: [], menu: [], starts: 0,
    response, blocked: 0,
  };
  const forbidden = () => { state.blocked++; throw new Error("Real I/O is forbidden in this verifier"); };
  const config = { platform: "docker-desktop", adminEmail: "fixture@example.invalid", adminPassword: "fake-password", storePassword: "fake-store" };
  const mocks = new Map();
  const mock = (relative, exports) => mocks.set(path.join(root, relative), exports);
  mock("cli/src/core/config.ts", {
    STORE_SERVICE: "switchyard-metrics", STORE_VOLUME: "switchyard-metrics",
    loadConfig: () => ({ config: { ...config }, path: "/fake-config-unused" }),
    saveConfig: (value) => state.saved.push({ ...value }),
  });
  mock("cli/src/core/docker.ts", {
    docker: async (args) => {
      state.calls.push([...args]);
      const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
      if (args[0] === "ps" && args.includes("--filter")) return ok();
      if (args[0] === "ps" || args[1] === "ls") {
        const kind = args[0] === "ps" ? "container" : args[0];
        return ok(state.remaining.filter((item) => item.kind === kind).map((item) => item.name).join("\n"));
      }
      assert.ok(args[0] === "rm" || args[1] === "rm", `Unexpected Docker command ${args}`);
      const kind = args[0] === "rm" ? "container" : args[0];
      if (kind === failKind) return { code: 1, stdout: "", stderr: "synthetic permission denied" };
      const index = state.remaining.findIndex((item) => item.kind === kind && item.name === args.at(-1));
      assert.notEqual(index, -1, `Missing fake resource ${args}`);
      state.remaining.splice(index, 1);
      return ok();
    },
    dockerOk: forbidden, dockerInherit: forbidden, dockerAvailability: forbidden,
  });
  mock("cli/src/core/dokploy-api.ts", {});
  mock("cli/src/core/repair.ts", {});
  mock("cli/src/core/ports.ts", {});
  mock("desktop/src/main/logging.ts", {
    log: (line) => state.logs.push(line), onLog: () => {}, recentLogs: () => [...state.logs],
  });
  mock("desktop/src/main/prereqs.ts", {});
  mock("desktop/src/main/settings.ts", { loadSettings: () => ({ openAtLogin: false }) });
  mock("desktop/src/main/autologin.ts", {});
  mock("desktop/src/main/updater.ts", {});
  const electron = {
    app: { on: () => {}, requestSingleInstanceLock: () => false, quit: () => {}, isPackaged: false },
    dialog: { showMessageBox: async (options) => {
      state.dialogs.push(options);
      return { response: state.response };
    } },
    Menu: { buildFromTemplate: (items) => { state.menu = items; return items; } },
    nativeImage: { createFromPath: () => ({}) },
    Tray: class { setToolTip() {} on() {} setContextMenu() {} },
  };
  const context = vm.createContext({
    console: { log: () => {} },
    process: { env: {}, argv: [], platform: "darwin", arch: "arm64" },
    setTimeout: forbidden, clearTimeout: () => {}, fetch: forbidden,
  });
  const cache = new Map();
  const allowedBuiltins = new Set(["node:events", "node:path", "node:crypto"]);
  function load(relative) {
    const filename = path.isAbsolute(relative) ? relative : path.join(root, relative);
    if (mocks.has(filename)) return mocks.get(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    assert.ok(filename.startsWith(root + path.sep));
    let source = fs.readFileSync(filename, "utf8");
    if (filename.endsWith("desktop/src/main/index.ts")) {
      source += "\nexport const verify = { dispatchAction, confirmReset, trayDeps, orchestrator };\n";
    }
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    });
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = (id) => {
      if (id === "electron") return electron;
      if (allowedBuiltins.has(id)) return require(id);
      if (!id.startsWith(".")) return forbidden();
      return load(path.resolve(path.dirname(filename), id.replace(/\.js$/, ".ts")));
    };
    const run = vm.runInContext(`(function(require, module, exports, __dirname) {\n${outputText}\n})`, context, { filename });
    run(localRequire, module, module.exports, path.dirname(filename));
    return module.exports;
  }
  // Prevent any startup/converge after reset. The teardown itself is real code.
  const { Orchestrator } = load("desktop/src/main/orchestrator.ts");
  Orchestrator.prototype.run = async () => { state.starts++; };
  const orchestrator = new Orchestrator();
  return { state, load, orchestrator };
}

test("actual stopStack: shared planner path preserves workloads and all volumes", async () => {
  const { state, orchestrator } = harness();
  await orchestrator.stopStack();
  assert.equal(orchestrator.currentPhase(), "stopped");
  assert.equal(orchestrator.isBusy(), false);
  assert.deepEqual(state.remaining, [...controlPlane.filter(({ kind }) => kind !== "container" && kind !== "service"), ...workloads]);
  assert.equal(state.saved.length, 0);
  assert.equal(state.starts, 0);
  const mutationCount = state.calls.filter((args) => args.includes("rm")).length;
  await orchestrator.stopStack();
  assert.equal(state.calls.filter((args) => args.includes("rm")).length, mutationCount);
  assert.equal(state.blocked, 0);
});

test("actual resetAll: workloads survive, control-plane config cleared only after successful teardown", async () => {
  const { state, orchestrator } = harness();
  await orchestrator.resetAll();
  assert.deepEqual(state.remaining, workloads);
  assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0].adminEmail, "");
  assert.equal(state.saved[0].adminPassword, "");
  assert.equal(state.saved[0].storePassword, "");
  assert.equal(state.starts, 1);
  assert.equal(state.blocked, 0);
  assert.ok(state.logs.some((line) => /orphaned/.test(line)));
});

test("actual resetAll: failed removal retains stored config and skips reinstall", async () => {
  const { state, orchestrator } = harness({ failKind: "volume" });
  await orchestrator.resetAll();
  assert.equal(orchestrator.currentPhase(), "error");
  assert.equal(orchestrator.isBusy(), false);
  assert.equal(state.saved.length, 0);
  assert.equal(state.starts, 0);
  assert.match(orchestrator.snapshot().error.message, /Removing control-plane volume/);
  assert.equal(state.blocked, 0);
});

test("actual tray names describe the control-plane scope", () => {
  const { state, load } = harness();
  load("desktop/src/main/tray.ts").createTray({ getPhase: () => "ready", getOpenAtLogin: () => false });
  const labels = state.menu.map((item) => item.label);
  assert.ok(labels.includes("Stop control plane"));
  assert.ok(labels.includes("Reset control plane…"));
  assert.ok(!labels.includes("Stop stack") && !labels.includes("Reset everything…"));
});

test("actual tray reset: cancel is default, warning is explicit, cancel does no Docker I/O", async () => {
  const { state, load } = harness();
  const { verify } = load("desktop/src/main/index.ts");
  await verify.confirmReset();
  assert.equal(state.dialogs.length, 1);
  const dialog = state.dialogs[0];
  assert.deepEqual(serial(dialog.buttons), ["Reset control plane", "Cancel"]);
  assert.equal(dialog.defaultId, 1);
  assert.equal(dialog.cancelId, 1);
  assert.match(dialog.detail, /NOT removed/);
  assert.match(dialog.detail, /orphaned/);
  assert.deepEqual(state.calls, []);
  assert.equal(state.starts, 0);
});

test("actual fresh-start action routes through the same confirmation", async () => {
  const { state, load } = harness();
  const { verify } = load("desktop/src/main/index.ts");
  await verify.dispatchAction("freshStart");
  assert.equal(state.dialogs.length, 1);
  assert.deepEqual(state.calls, []);
  assert.match(state.dialogs[0].message, /control-plane data/);
});

test("confirm accepts exactly once and busy state prevents a second reset dialog", async () => {
  const { state, load } = harness({ response: 0 });
  const { verify } = load("desktop/src/main/index.ts");
  let resets = 0;
  verify.orchestrator.resetAll = async () => { resets++; };
  await verify.confirmReset();
  assert.equal(resets, 1);
  verify.orchestrator.busy = true;
  await verify.confirmReset();
  assert.equal(resets, 1);
  assert.equal(state.dialogs.length, 1);
});

test("direct orchestrator fresh-start action cannot bypass confirmation", async () => {
  const { state, orchestrator } = harness();
  await orchestrator.handleAction("freshStart");
  assert.deepEqual(state.calls, []);
  assert.equal(state.saved.length, 0);
});

test("actual stopped renderer tells users that workloads remain running", async () => {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { contains: () => false, querySelector: () => null });
      return elements.get(id);
    },
    addEventListener() {},
  };
  let render;
  const window = { switchyardDesktop: { onState: (callback) => { render = callback; }, getState: async () => null } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "desktop/src/renderer/app.js"), "utf8"), { document, window });
  render({ phase: "stopped", steps: [], logTail: [], version: "fixture" });
  assert.match(elements.get("view").innerHTML, /control plane is stopped/);
  assert.match(elements.get("view").innerHTML, /left running/);
  assert.match(elements.get("view").innerHTML, /URLs may be unavailable/);
});
