// Standalone checks against real dashboard sources; no project test runner added.
// Usage: node /tmp/verify-stored-log-history.cjs [/path/to/worktree]
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = process.argv[2] || "/workspace/wt-stored-log-history";
const ts = require(path.join(root, "dashboard/node_modules/typescript"));
const marker = "— container is not running —";
const app = "workspace-demo-app";
const plain = (value) => JSON.parse(JSON.stringify(value));

function load(relativePath, stubs = {}, globals = {}) {
  const filename = path.join(root, relativePath);
  const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  });
  assert.equal(diagnostics.length, 0, `transpile diagnostics: ${filename}`);
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(stubs, name)) return stubs[name];
      throw new Error(`Unexpected dependency ${name} in ${relativePath}`);
    },
    Buffer, TextDecoder, TextEncoder, ReadableStream, Response, Request, URL, console,
    ...globals,
  }, { filename });
  return module.exports;
}

const sse = load("dashboard/src/lib/sse.ts");
const request = (name = app) => new Request(`http://localhost:3001/api/services/logs${name === null ? "" : `?app=${encodeURIComponent(name)}`}`);

function parseSse(body) {
  return body.split("\n\n").filter(Boolean).map((frame) => {
    let type = "message";
    const data = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trimStart();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return { type, data: JSON.parse(data.join("\n")) };
  });
}

function route({ allowed = new Set([app]), workspaceError, src = null, query = async () => [] } = {}) {
  const calls = { known: 0, follow: [], query: [] };
  const module = load("dashboard/src/app/api/services/logs/route.ts", {
    "next/navigation": { unstable_rethrow() {} },
    "@/lib/docker": { async followLogs(...args) { calls.follow.push(args); return src; } },
    "@/lib/dokploy": { async knownAppNames() {
      calls.known++;
      if (workspaceError) throw workspaceError;
      return allowed;
    } },
    "@/lib/store": { async queryLogs(...args) { calls.query.push(args); return query(...args); } },
    "@/lib/sse": sse,
  });
  return { ...module, calls, allowed };
}

async function responseFrames(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  // Reading text also verifies that the one-shot stream closes.
  return parseSse(await response.text());
}

function assertStopped(frames, stored = []) {
  assert.deepEqual(frames[0], { type: "reset", data: {} });
  assert.equal(frames.length, stored.length + 2);
  assert.deepEqual(frames.slice(1, -1), stored.map((line) => ({ type: "message", data: { ...line, stored: true } })));
  const last = frames.at(-1);
  assert.equal(last.type, "message");
  assert.equal(last.data.text, marker);
  assert.equal(typeof last.data.ts, "number");
  assert.deepEqual(Object.keys(last.data).sort(), ["text", "ts"]);
}

function store({ enabled = true, fixtures = [], fail = false } = {}) {
  const calls = { pools: 0, schema: 0, query: [], warnings: [] };
  class FakePool {
    constructor(options) {
      calls.pools++;
      assert.equal(options.connectionString, "postgresql://fake-store/database");
    }
    on() {}
    async query(sql, args) {
      if (sql.startsWith("CREATE TABLE")) { calls.schema++; return { rows: [] }; }
      calls.query.push({ sql, args: plain(args) });
      if (fail) throw new Error("store unavailable");
      // Validate the actual SQL before implementing its restricted fake database
      // semantics. A changed/missing predicate, limit, order, tie-break, or bind
      // fails here rather than accidentally passing against canned results.
      assert.equal(sql.replace(/\s+/g, " ").trim(),
        "SELECT ts, text FROM ( SELECT id, ts, text FROM log_lines WHERE app_name = $1 AND ts >= $2 ORDER BY ts DESC, id DESC LIMIT $3 ) t ORDER BY ts ASC, id ASC");
      const [name, since, limit] = args;
      assert.equal(args.length, 3);
      assert.equal(typeof limit, "number");
      const rows = fixtures.filter((row) => row.app_name === name && Number(row.ts) >= since)
        .sort((a, b) => Number(b.ts) - Number(a.ts) || Number(b.id) - Number(a.id))
        .slice(0, limit)
        .sort((a, b) => Number(a.ts) - Number(b.ts) || Number(a.id) - Number(b.id))
        .map(({ ts, text }) => ({ ts: String(ts), text }));
      return { rows };
    }
    async end() {}
  }
  const module = load("dashboard/src/lib/store.ts", { pg: { Pool: FakePool } }, {
    process: { env: enabled ? { SWITCHYARD_STORE_URL: "postgresql://fake-store/database" } : {} },
    console: { warn(...args) { calls.warnings.push(args); } },
  });
  return { ...module, calls };
}

function mountLogsTab() {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let tree;
  const instances = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.handlers = new Map(); instances.push(this); }
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    emit(type, data = {}) {
      const event = { data: JSON.stringify(data) };
      this[`on${type}`]?.(event);
      this.handlers.get(type)?.(event);
    }
    close() { this.closed = true; }
  }
  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: initial };
      return [hooks[index].value, (value) => {
        hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value;
      }];
    },
    useRef(initial) { return (hooks[cursor++] ??= { current: initial }); },
    useEffect(effect, deps) {
      const index = cursor++;
      const prior = hooks[index];
      if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) {
        effects.push(() => {
          prior?.cleanup?.();
          hooks[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const { LogsTab } = load("dashboard/src/components/service/LogsTab.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { Loader2() {}, Search() {} },
  }, { EventSource: FakeEventSource });
  function render() {
    cursor = 0;
    effects = [];
    tree = LogsTab({ appName: app, active: true });
    for (const effect of effects) effect();
    return tree;
  }
  render();
  assert.equal(instances.length, 1);
  return {
    es: instances[0], render,
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

function textOf(tree) {
  if (Array.isArray(tree)) return tree.map(textOf).join("");
  if (!tree || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return textOf(tree.props?.children);
}

function logRows(tree) {
  return nodes(tree).filter((node) => node.type === "div" && node.props.className?.includes("whitespace-pre-wrap"));
}

const tests = [
  ["stopped container emits reset, stored lines in order, then one unchanged marker", async () => {
    const history = [{ ts: 100, text: "first café 😀" }, { ts: 101, text: "crash\n\nevent: reset\ndata: {}" }];
    const handler = route({ query: async () => history });
    assertStopped(await responseFrames(await handler.GET(request())), history);
    assert.deepEqual(handler.calls.query, [[app, 0, 300]]);
    assert.equal(handler.calls.follow.length, 1);
    assert.equal(handler.calls.follow[0][0], app);
    assert.equal(handler.calls.follow[0][1], 300);
    assert.strictEqual(handler.calls.follow[0][2], handler.allowed);
  }],
  ["empty history retains reset and stopped marker", async () => {
    assertStopped(await responseFrames(await route().GET(request())));
  }],
  ["throwing store retains reset and stopped marker", async () => {
    assertStopped(await responseFrames(await route({ query: async () => { throw new Error("store down"); } }).GET(request())));
  }],
  ["unset store URL performs no database work and retains old stopped behavior", async () => {
    const db = store({ enabled: false });
    assert.equal(db.storeEnabled(), false);
    assertStopped(await responseFrames(await route({ query: db.queryLogs }).GET(request())));
    assert.equal(db.calls.pools, 0);
    assert.equal(db.calls.query.length, 0);
  }],
  ["database failure degrades to old behavior without exposing store errors", async () => {
    const db = store({ fail: true });
    assertStopped(await responseFrames(await route({ query: db.queryLogs }).GET(request())));
    assert.equal(db.calls.query.length, 1);
    assert.equal(db.calls.warnings.length, 1);
    assert.deepEqual(plain(await db.queryLogs(app, 0, 300)), []);
    assert.equal(db.calls.query.length, 1, "disabled store must remain a no-op");
  }],
  ["ownership rejects unknown apps before Docker or history access", async () => {
    const handler = route();
    const response = await handler.GET(request("other-workspace-secret-app"));
    assert.equal(response.status, 403);
    assert.equal(await response.text(), "unknown app");
    assert.equal(handler.calls.follow.length, 0);
    assert.equal(handler.calls.query.length, 0);
  }],
  ["workspace failure fails closed before Docker or history access", async () => {
    const handler = route({ workspaceError: new Error("Dokploy down") });
    const response = await handler.GET(request());
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "workspace unavailable");
    assert.equal(handler.calls.follow.length, 0);
    assert.equal(handler.calls.query.length, 0);
  }],
  ["missing app retains 400 and does not read workspace, Docker, or history", async () => {
    const handler = route();
    const response = await handler.GET(request(null));
    assert.equal(response.status, 400);
    assert.equal(await response.text(), "missing ?app");
    assert.deepEqual(handler.calls, { known: 0, follow: [], query: [] });
  }],
  ["live stream resets immediately, preserves live data, and never queries history", async () => {
    const stream = new EventEmitter();
    let closes = 0;
    const handler = route({ src: { stream, close() { closes++; } } });
    const response = await handler.GET(request());
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.deepEqual(parseSse(new TextDecoder().decode(first.value)), [{ type: "reset", data: {} }]);
    const stamp = "2026-10-23T12:00:00.000Z";
    for (const byte of Buffer.from(`${stamp} live café 😀\n`)) stream.emit("data", Buffer.from([byte]));
    stream.emit("end");
    let body = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += new TextDecoder().decode(chunk.value);
    }
    assert.deepEqual(parseSse(body), [{ type: "message", data: { ts: Date.parse(stamp), text: "live café 😀" } }]);
    assert.equal(closes, 1);
    assert.equal(handler.calls.query.length, 0);
  }],
  ["queryLogs binds identity, since, limit and returns newest 300 oldest-first with deterministic ties", async () => {
    const name = "name' OR 1=1 --";
    const fixtures = Array.from({ length: 350 }, (_, index) => ({
      id: index + 1, app_name: name, ts: 1000 + Math.floor(index / 2), text: `line ${index + 1}`,
    }));
    fixtures.push({ id: 999, app_name: "other-app", ts: 99999, text: "private" });
    fixtures.push({ id: 1000, app_name: name, ts: 50, text: "too old" });
    const db = store({ fixtures: fixtures.reverse() });
    const lines = plain(await db.queryLogs(name, 1000, 300));
    assert.equal(lines.length, 300);
    assert.deepEqual(lines, Array.from({ length: 300 }, (_, index) => ({
      ts: 1000 + Math.floor((index + 50) / 2), text: `line ${index + 51}`,
    })));
    assert.deepEqual(db.calls.query[0].args, [name, 1000, 300]);
    assert(!db.calls.query[0].sql.includes(name), "app name must remain a bound parameter");
    const tied = plain(await db.queryLogs(name, 1174, 1));
    assert.deepEqual(tied, [{ ts: 1174, text: "line 350" }]);
    assert.equal(db.calls.schema, 1);
    await db.closeStore();
  }],
  ["LogsTab labels and dims history, filters it, and clears it on live reset", async () => {
    const client = mountLogsTab();
    const history = [{ ts: 100, text: "Old ERROR café" }, { ts: 101, text: "old info" }];
    const frames = await responseFrames(await route({ query: async () => history }).GET(request()));
    for (const frame of frames) client.es.emit(frame.type, frame.data);
    let tree = client.render();
    assert.match(textOf(tree), /from history/i);
    let rows = logRows(tree);
    assert.equal(rows.length, 3);
    assert(rows[0].props.className.includes("opacity-70"));
    assert(rows[1].props.className.includes("opacity-70"));
    assert(!rows[2].props.className.includes("opacity-70"));
    const input = nodes(tree).find((node) => node.type === "input");
    input.props.onChange({ target: { value: "error CAFÉ" } });
    tree = client.render();
    assert.deepEqual(logRows(tree).map(textOf).map((text) => text.slice(-history[0].text.length)), [history[0].text]);
    assert.match(textOf(tree), /from history/i);
    input.props.onChange({ target: { value: "not running" } });
    tree = client.render();
    assert.equal(logRows(tree).length, 1);
    assert(textOf(logRows(tree)[0]).endsWith(marker));
    assert.doesNotMatch(textOf(tree), /from history/i);
    input.props.onChange({ target: { value: "" } });
    client.es.emit("reset");
    client.es.emit("message", { ts: 200, text: "live replacement" });
    tree = client.render();
    rows = logRows(tree);
    assert.equal(rows.length, 1);
    assert(textOf(rows[0]).endsWith("live replacement"));
    assert(!rows[0].props.className.includes("opacity-70"));
    assert.doesNotMatch(textOf(tree), /from history|old info|Old ERROR|container is not running/i);
    client.unmount();
    assert.equal(client.es.closed, true);
  }],
];

(async () => {
  let passed = 0;
  for (const [name, run] of tests) {
    let timer;
    try {
      await Promise.race([
        run(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("check timed out")), 3000); }),
      ]);
      console.log(`PASS ${name}`);
      passed++;
    } catch (error) {
      console.error(`FAIL ${name}\n${error.stack}`);
    } finally {
      clearTimeout(timer);
    }
  }
  console.log(`${passed}/${tests.length} verification checks passed`);
  if (passed !== tests.length) process.exitCode = 1;
})();
