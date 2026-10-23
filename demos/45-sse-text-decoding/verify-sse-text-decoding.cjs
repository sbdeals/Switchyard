// Standalone regression checks against the real dashboard sources; no test runner added.
// Usage: node /tmp/verify-sse-text-decoding.cjs [/path/to/worktree]
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const nodeStream = require("node:stream");
const vm = require("node:vm");

const root = process.argv[2] || "/workspace/wt-sse-text-decoding";
const ts = require(path.join(root, "dashboard/node_modules/typescript"));
const limit = 64 * 1024;

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
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(stubs, name)) return stubs[name];
      throw new Error(`Unexpected dependency ${name} in ${relativePath}`);
    },
    Buffer,
    TextDecoder,
    TextEncoder,
    ReadableStream,
    Response,
    Request,
    URL,
    console,
    ...globals,
  });
  vm.runInContext(outputText, context, { filename });
  return module.exports;
}

const helper = load("dashboard/src/lib/sse.ts");

function source() {
  const stream = new EventEmitter();
  let closes = 0;
  return {
    stream,
    close() {
      closes++;
      // Real source teardown may synchronously produce another close event.
      stream.emit("close");
    },
    get closes() { return closes; },
  };
}

function request(signal) {
  return new Request("http://localhost/api/services/logs?app=demo", { signal });
}

function responseFor(src, req = request(), seen = []) {
  return helper.sseFromLines(src, req, (line) => {
    seen.push(line);
    return `${JSON.stringify(line)}\n`;
  });
}

async function linesFrom(response) {
  const body = await response.text();
  return body ? body.trimEnd().split("\n").map((line) => JSON.parse(line)) : [];
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 1000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function parseSse(body) {
  return body.split("\n\n").filter(Boolean).map((frame) => {
    let type = "message";
    const data = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trimStart();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return { type, data: data.join("\n") };
  });
}

function mountLogsTab() {
  const states = [];
  const effects = [];
  const cleanups = [];
  const instances = [];
  class MockEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      instances.push(this);
    }
    addEventListener(type, fn) {
      const handlers = this.listeners.get(type) || [];
      handlers.push(fn);
      this.listeners.set(type, handlers);
    }
    removeEventListener(type, fn) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter((handler) => handler !== fn));
    }
    emit(type, data = "") {
      const event = { type, data };
      this[`on${type}`]?.(event);
      for (const fn of this.listeners.get(type) || []) fn(event);
    }
    close() { this.closed = true; }
  }
  const react = {
    useState(initial) {
      const index = states.length;
      states.push(initial);
      return [initial, (value) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      }];
    },
    useRef(initial) { return { current: initial }; },
    useEffect(effect) { effects.push(effect); },
  };
  const jsx = (type, props) => ({ type, props });
  const { LogsTab } = load("dashboard/src/components/service/LogsTab.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { Loader2: () => null, Search: () => null },
  }, { EventSource: MockEventSource });
  LogsTab({ appName: "demo", active: true });
  for (const effect of effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  assert.equal(instances.length, 1);
  return {
    es: instances[0],
    get lines() { return Array.from(states[0], (line) => ({ ...line })); },
    get connected() { return states[1]; },
    unmount() { for (const cleanup of cleanups) cleanup(); },
  };
}

function routeFor(src) {
  return load("dashboard/src/app/api/services/logs/route.ts", {
    "next/navigation": { unstable_rethrow() {} },
    "@/lib/docker": { async followLogs(app, tail, allowed) {
      assert.equal(app, "demo");
      assert.equal(tail, 300);
      assert(allowed.has("demo"));
      return src;
    } },
    "@/lib/dokploy": { async knownAppNames() { return new Set(["demo"]); } },
    "@/lib/sse": helper,
  });
}

const tests = [
  ["UTF-8 is preserved at every byte split, with the final partial line flushed on end", async () => {
    const text = "prefix café 雪 😀\ntrailing π";
    const bytes = Buffer.from(text);
    for (let split = 1; split < bytes.length; split++) {
      const src = source();
      const response = responseFor(src);
      src.stream.emit("data", bytes.subarray(0, split));
      src.stream.emit("data", bytes.subarray(split));
      src.stream.emit("end");
      assert.deepEqual(await linesFrom(response), text.split("\n"), `byte split ${split}`);
      assert.equal(src.closes, 1);
    }
  }],
  ["close flushes pending text and decoder bytes exactly once", async () => {
    const src = source();
    const response = responseFor(src);
    for (const byte of Buffer.from("done 雪\npartial 😀")) src.stream.emit("data", Buffer.from([byte]));
    src.stream.emit("close");
    src.stream.emit("end");
    src.stream.emit("close");
    assert.deepEqual(await linesFrom(response), ["done 雪", "partial 😀"]);
    assert.equal(src.closes, 1);
  }],
  ["end flushes an incomplete UTF-8 sequence once; later end/close/data are harmless", async () => {
    const src = source();
    const response = responseFor(src);
    src.stream.emit("data", Buffer.from("partial "));
    src.stream.emit("data", Buffer.from([0xf0, 0x9f]));
    src.stream.emit("end");
    assert.doesNotThrow(() => {
      src.stream.emit("end");
      src.stream.emit("close");
      src.stream.emit("data", Buffer.from("late\n"));
    });
    assert.deepEqual(await linesFrom(response), ["partial �"]);
    assert.equal(src.closes, 1);
  }],
  ["close flushes a decoder containing only an incomplete UTF-8 sequence", async () => {
    const src = source();
    const response = responseFor(src);
    src.stream.emit("data", Buffer.from([0xe2, 0x82]));
    src.stream.emit("close");
    assert.deepEqual(await linesFrom(response), ["�"]);
    assert.equal(src.closes, 1);
  }],
  ["pending lines are emitted at the 64 KiB bound without splitting surrogate pairs", async () => {
    const src = source();
    const seen = [];
    const response = responseFor(src, request(), seen);
    const longLine = "a".repeat(limit - 1) + "😀" + "b".repeat(limit + 4);
    src.stream.emit("data", Buffer.from(longLine));
    assert(seen.length >= 1, "a long partial line must be emitted before EOF");
    assert(longLine.length - seen.join("").length <= limit, "pending text must be bounded");
    src.stream.emit("end");
    const lines = await linesFrom(response);
    assert.equal(lines.join(""), longLine);
    for (const line of lines) {
      assert(line.length <= limit + 1, "an emitted fragment must respect the bound plus one surrogate unit");
      for (const char of line) {
        assert(!(char.length === 1 && /[\uD800-\uDFFF]/.test(char)), "an emitted fragment contains an unpaired surrogate");
      }
    }
    assert.equal(src.closes, 1);
  }],
  ["blank lines and null event mappings retain their existing behavior", async () => {
    const src = source();
    const response = helper.sseFromLines(src, request(), (line) => line === "skip" ? null : `${JSON.stringify(line)}\n`);
    src.stream.emit("data", Buffer.from("\n  \nkeep\nskip\n  final  "));
    src.stream.emit("end");
    assert.deepEqual(await linesFrom(response), ["keep", "  final  "]);
  }],
  ["forced whitespace fragments and tails survive EOF or newline, then continuation resets", async () => {
    const text = " ".repeat(2 * limit + 3);
    for (const finish of ["end", "newline"]) {
      const src = source();
      const seen = [];
      const response = helper.sseFromLines(src, request(), (line, continuation) => {
        seen.push({ line, continuation });
        return `${JSON.stringify(line)}\n`;
      });
      src.stream.emit("data", Buffer.from(text));
      assert.equal(seen.length, 2, "both oversized whitespace fragments must be emitted before EOF");
      if (finish === "newline") src.stream.emit("data", Buffer.from("\nnext fresh line\n \t"));
      src.stream.emit("end");
      const lines = await linesFrom(response);
      assert.equal(lines.slice(0, 3).join(""), text);
      assert.deepEqual(seen.map((entry) => entry.continuation), finish === "end"
        ? [false, true, true]
        : [false, true, true, false]);
      if (finish === "newline") assert.equal(lines[3], "next fresh line");
      assert.equal(lines.length, finish === "end" ? 3 : 4);
    }
  }],
  ["abort flushes once and detaches listeners before late source data", async () => {
    const src = source();
    const abort = new AbortController();
    const response = responseFor(src, request(abort.signal));
    src.stream.emit("data", Buffer.from("queued\npending "));
    src.stream.emit("data", Buffer.from([0xf0, 0x9f]));
    abort.abort();
    assert.doesNotThrow(() => {
      src.stream.emit("data", Buffer.from("late\n"));
      src.stream.emit("end");
      src.stream.emit("close");
    });
    assert.deepEqual(await linesFrom(response), ["queued", "pending �"]);
    assert.equal(src.closes, 1);
    assert.equal(src.stream.listenerCount("data"), 0);
  }],
  ["reader cancellation closes once and ignores late source data", async () => {
    const src = source();
    const response = responseFor(src);
    const reader = response.body.getReader();
    src.stream.emit("data", Buffer.from("pending"));
    await reader.cancel();
    assert.doesNotThrow(() => {
      src.stream.emit("data", Buffer.from("late\n"));
      src.stream.emit("end");
      src.stream.emit("close");
    });
    assert.equal(src.closes, 1);
    assert.equal(src.stream.listenerCount("data"), 0);
    assert.equal((await reader.read()).done, true);
  }],
  ["an already aborted request immediately closes its source", async () => {
    const src = source();
    const abort = new AbortController();
    abort.abort();
    const response = responseFor(src, request(abort.signal));
    assert.deepEqual(await linesFrom(response), []);
    assert.equal(src.closes, 1);
    assert.equal(src.stream.listenerCount("data"), 0);
  }],
  ["real followLogs demux preserves split UTF-8 and flushes on raw close without end", async () => {
    const raw = new nodeStream.PassThrough();
    let ended = false;
    raw.on("end", () => { ended = true; });
    const Modem = require(path.join(root, "dashboard/node_modules/docker-modem/lib/modem"));
    class MockDocker {
      async listContainers() { return [{ Id: "container-id", Names: ["/demo.1.task"] }]; }
      getContainer(id) {
        assert.equal(id, "container-id");
        return {
          modem: { demuxStream: Modem.prototype.demuxStream },
          async logs(options) {
            assert.equal(options.follow, true);
            assert.equal(options.timestamps, true);
            return raw;
          },
        };
      }
    }
    const { followLogs } = load("dashboard/src/lib/docker.ts", {
      dockerode: { default: MockDocker },
      "node:stream": nodeStream,
    }, { process: { env: {} }, setTimeout, clearTimeout });
    const src = await followLogs("demo", 300, new Set(["demo"]));
    assert(src);
    const response = responseFor(src);
    const text = "demux café 😀\ntrailing 雪";
    for (const byte of Buffer.from(text)) {
      const header = Buffer.alloc(8);
      header[0] = 1;
      header.writeUInt32BE(1, 4);
      const frame = Buffer.concat([header, Buffer.from([byte])]);
      raw.write(frame.subarray(0, 5));
      raw.write(frame.subarray(5));
    }
    raw.destroy();
    assert.deepEqual(await linesFrom(response), text.split("\n"));
    assert.equal(ended, false, "the raw stream must close without an end event in this regression case");
  }],
  ["runtime reset is sent before log data and reconnect replaces the client buffer", async () => {
    const client = mountLogsTab();
    const timestamp = "2026-10-23T12:00:00.000Z";
    const replay = ["first café", "second 😀"];
    client.es.emit("open");
    assert.equal(client.connected, true);
    client.es.emit("message", JSON.stringify({ ts: 1, text: "old entry" }));
    client.es.emit("message", JSON.stringify({ ts: 2, text: replay[0] }));
    client.es.emit("error");
    assert.equal(client.connected, false);
    client.es.emit("open");
    const src = source();
    const response = await routeFor(src).GET(request());
    const reader = response.body.getReader();
    // The reset must arrive immediately, even before the source emits its first log line.
    const first = await withTimeout(reader.read(), "initial reset event");
    const initialFrames = parseSse(new TextDecoder().decode(first.value));
    assert.equal(initialFrames.length, 1);
    assert.equal(initialFrames[0].type, "reset");
    client.es.emit(initialFrames[0].type, initialFrames[0].data);
    assert.equal(client.lines.length, 0);
    const bytes = Buffer.from(replay.map((line) => `${timestamp} ${line}`).join("\n"));
    for (const byte of bytes) src.stream.emit("data", Buffer.from([byte]));
    src.stream.emit("end");
    let body = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += new TextDecoder().decode(chunk.value);
    }
    const frames = parseSse(body);
    assert.equal(frames.length, replay.length);
    for (const frame of frames) {
      assert.equal(frame.type, "message");
      assert.deepEqual(Object.keys(JSON.parse(frame.data)).sort(), ["text", "ts"]);
      client.es.emit(frame.type, frame.data);
    }
    assert.deepEqual(client.lines.map((line) => line.text), replay);
    assert(client.lines.every((line) => line.ts === Date.parse(timestamp)));
    assert.equal(new Set(client.lines.map((line) => line.id)).size, replay.length);
    // A second reconnect replays the same tail once, rather than appending duplicates.
    client.es.emit(initialFrames[0].type, initialFrames[0].data);
    for (const frame of frames) client.es.emit(frame.type, frame.data);
    assert.deepEqual(client.lines.map((line) => line.text), replay);
    client.unmount();
    assert.equal(client.es.closed, true);
  }],
  ["runtime long-line fragments preserve numeric words and emoji across the buffer bound", async () => {
    const src = source();
    const response = await routeFor(src).GET(request());
    const prefix = "2026-10-23T12:00:00.000Z ";
    const continuation = "123 fragment ";
    const text = "a".repeat(limit - prefix.length)
      + continuation + "b".repeat(limit - continuation.length - 1)
      + "😀 tail with words";
    const bytes = Buffer.from(prefix + text);
    const emojiOffset = bytes.indexOf(Buffer.from("😀"));
    src.stream.emit("data", bytes.subarray(0, emojiOffset + 1));
    src.stream.emit("data", bytes.subarray(emojiOffset + 1));
    src.stream.emit("end");
    const frames = parseSse(await response.text());
    assert.equal(frames[0].type, "reset");
    const logs = frames.slice(1).map((frame) => JSON.parse(frame.data));
    assert.equal(logs.length, 3);
    assert(logs[1].text.startsWith(continuation), "numeric continuation words must not be stripped as a timestamp");
    assert(logs[2].text.startsWith("😀 tail"), "a forced fragment must keep both its emoji and words");
    assert.equal(logs.map((line) => line.text).join(""), text);
    assert.equal(logs[0].ts, Date.parse(prefix.trim()));
  }],
  ["a timestamp-shaped continuation stays text and the next fresh line parses its timestamp", async () => {
    const src = source();
    const response = await routeFor(src).GET(request());
    const firstTimestamp = "2026-10-23T12:00:00.000Z";
    const embeddedTimestamp = "2026-10-24T13:00:00.000Z";
    const nextTimestamp = "2026-10-25T14:00:00.000Z";
    const prefix = `${firstTimestamp} `;
    const continuation = `${embeddedTimestamp} should remain text`;
    const text = "a".repeat(limit - prefix.length) + continuation;
    src.stream.emit("data", Buffer.from(prefix + text));
    src.stream.emit("data", Buffer.from(`\n${nextTimestamp} fresh line`));
    src.stream.emit("end");
    const frames = parseSse(await response.text());
    assert.equal(frames[0].type, "reset");
    const logs = frames.slice(1).map((frame) => JSON.parse(frame.data));
    assert.equal(logs.length, 3);
    assert.equal(logs[1].text, continuation);
    assert.equal(logs[0].text + logs[1].text, text);
    assert.equal(logs[0].ts, Date.parse(firstTimestamp));
    assert.equal(logs[2].text, "fresh line");
    assert.equal(logs[2].ts, Date.parse(nextTimestamp));
  }],
  ["the no-container response also resets old client logs before its placeholder", async () => {
    const client = mountLogsTab();
    client.es.emit("message", JSON.stringify({ ts: 1, text: "old entry" }));
    const response = await routeFor(null).GET(request());
    const frames = parseSse(await response.text());
    assert.equal(frames[0].type, "reset");
    for (const frame of frames) client.es.emit(frame.type, frame.data);
    assert.equal(client.lines.length, 1);
    assert.equal(client.lines[0].text, "— container is not running —");
    client.unmount();
  }],
];

(async () => {
  let passed = 0;
  for (const [name, run] of tests) {
    try {
      await withTimeout(run(), name);
      console.log(`PASS ${name}`);
      passed++;
    } catch (error) {
      console.error(`FAIL ${name}\n${error.stack}`);
    }
  }
  console.log(`${passed}/${tests.length} verification checks passed`);
  if (passed !== tests.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
