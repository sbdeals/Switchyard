import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import {
  connectPlatformClient, createLogsClient, createLogsCommand, defaultConfig,
  formatLogLine, infrastructureLogsCommand, LogDeduplicator, LogsRequestError, runServiceLogs,
} from "../dist/lib.js";

const a = { id: "container:1", ts: "2026-10-26T12:00:00.000000001Z", text: "hello" };
const b = { id: "container:2", ts: "2026-10-26T12:00:00.000000002Z", text: "hello" };
const project = { projectId: "p1", name: "demo", environments: [
  { environmentId: "e1", name: "production", compose: [{ composeId: "s1", name: "web" }] },
] };
const flags = { service: "web", project: "p1" };
const page = (lines, truncated = false) => ({ lines, truncated });
const clientFor = (readLogs) => ({
  request: async (path) => { assert.equal(path, "project.all"); return [project]; },
  readLogs,
});

test("logs arguments: defaults and every option", async () => {
  let parsed;
  await createLogsCommand(async (flags) => { parsed = flags; }).parseAsync([], { from: "user" });
  assert.deepEqual(parsed, { lines: 200 });
  await createLogsCommand(async (flags) => { parsed = flags; }).parseAsync([
    "--service", "web", "--project", "p1", "--lines", "5", "--follow", "--json", "--since", "15m",
  ], { from: "user" });
  assert.deepEqual(parsed, { service: "web", project: "p1", lines: 5, follow: true, json: true, since: "15m" });
  for (const since of ["1h", "6h"]) {
    await createLogsCommand(async (flags) => { parsed = flags; }).parseAsync(["-f", "--since", since], { from: "user" });
    assert.equal(parsed.since, since);
    assert.equal(parsed.follow, true);
  }
});

for (const args of [
  ["--service"], ["--project"], ["--lines"], ["--since"], ["--unknown"], ["one", "two"],
  ...["0", "-1", "1.5", "1001", "NaN", "1e2", "0x10", " "].map((n) => ["--lines", n]),
  ["--since", "2h"],
]) {
  test(`logs rejects invalid arguments: ${args.join(" ")}`, async () => {
    const cmd = createLogsCommand(async () => assert.fail("Must not read logs"))
      .exitOverride().configureOutput({ writeErr: () => {} });
    await assert.rejects(cmd.parseAsync(args, { from: "user" }));
  });
}

for (const target of ["switchyard", "dokploy"]) {
  for (const follow of [[], ["-f"], ["--follow"]]) {
    test(`reserved positional target uses infrastructure logs: ${[target, ...follow].join(" ")}`, async () => {
      const calls = [];
      const cmd = createLogsCommand(async () => assert.fail("Must not use the service API"), async (name, flags) => {
        calls.push({ name, flags });
      });
      await cmd.parseAsync([target, ...follow], { from: "user" });
      assert.deepEqual(calls, [{ name: target, flags: { lines: 200, ...(follow.length ? { follow: true } : {}) } }]);
    });
  }

  for (const follow of [false, true]) {
    test(`infrastructure ${target} uses the original Docker arguments and exit status (follow=${follow})`, async () => {
      const previousExitCode = process.exitCode;
      try {
        const calls = [];
        await infrastructureLogsCommand(target, { follow }, async (args) => { calls.push(args); return 7; });
        assert.deepEqual(calls, [[
          ...(target === "dokploy" ? ["service", "logs"] : ["logs"]),
          ...(follow ? ["--follow"] : []), "--tail", "200", target,
        ]]);
        assert.equal(process.exitCode, 7);
      } finally { process.exitCode = previousExitCode; }
    });
  }
}

for (const service of ["web", "switchyard", "dokploy"]) {
  test(`--service ${service} uses the service API path`, async () => {
    let selected;
    const cmd = createLogsCommand(async (flags) => { selected = flags; }, async () => assert.fail("Must not use Docker"));
    await cmd.parseAsync(["--service", service, "--json", "--follow"], { from: "user" });
    assert.deepEqual(selected, { service, lines: 200, json: true, follow: true });
  });
}

test("non-reserved positional names and IDs use the service API path", async () => {
  for (const service of ["web", "service-id-123"]) {
    let selected;
    const cmd = createLogsCommand(async (flags) => { selected = flags; }, async () => assert.fail("Must not use Docker"));
    await cmd.parseAsync([service, "--project", "p1", "--lines", "5", "--json", "--since", "1h"], { from: "user" });
    assert.deepEqual(selected, { service, project: "p1", lines: 5, json: true, since: "1h" });
  }
});

for (const args of [["switchyard", "--service", "web"], ["dokploy", "--service", "dokploy"], ["web", "--service", "other"], ["--service", "web", "web"]]) {
  test(`positional target conflicts with --service: ${args.join(" ")}`, async () => {
    const cmd = createLogsCommand(async () => assert.fail("Must not use the service API"), async () => assert.fail("Must not use Docker"));
    await assert.rejects(cmd.parseAsync(args, { from: "user" }), /Cannot combine a positional logs target with --service/);
  });
}

test("dedup handles overlap, repeated messages, nanoseconds, and container replacement", () => {
  const dedup = new LogDeduplicator();
  assert.deepEqual(dedup.take([a, a, b]), [a, b]);
  assert.deepEqual(dedup.take([b]), []);
  const restarted = { ...a, id: "replacement:1" };
  assert.deepEqual(dedup.take([a, b, restarted]), [restarted]);
});

test("dedup retains the maximum overlapping poll window after many lines", () => {
  const dedup = new LogDeduplicator();
  for (let i = 0; i < 5; i++) {
    const lines = Array.from({ length: 1000 }, (_, j) => ({ ...a, id: String(i * 1000 + j) }));
    assert.equal(dedup.take(lines).length, 1000);
    assert.equal(dedup.take(lines).length, 0);
  }
});

test("plain and NDJSON formatting preserve text and timestamps", () => {
  const line = { ...a, text: 'quotes " and \\ and\nnewlines\t雪' };
  assert.equal(formatLogLine(line), `${line.ts} ${line.text}`);
  const json = formatLogLine(line, true);
  assert.equal(json.split("\n").length, 1);
  assert.deepEqual(JSON.parse(json), line);
});

test("one-shot resolves service, forwards filters and only prints NDJSON records", async () => {
  const output = [];
  const warnings = [];
  const selected = { ...flags, lines: 5, since: "1h", json: true };
  await runServiceLogs(selected, clientFor(async (id, options) => {
    assert.equal(id, "s1");
    assert.deepEqual(options, selected);
    return page([a, b], true);
  }), { write: (s) => output.push(s), warn: (s) => warnings.push(s) });
  assert.deepEqual(output.map(JSON.parse), [a, b]);
  assert.equal(warnings.length, 1);
});

test("follow deduplicates, backs off idle polls, resets on fresh lines and aborts cleanly", async () => {
  const controller = new AbortController();
  const pages = [page([a]), page([a]), page([a]), page([a, b])];
  const output = [];
  const waits = [];
  await runServiceLogs({ ...flags, follow: true }, clientFor(async () => pages.shift()), {
    signal: controller.signal, write: (s) => output.push(s),
    wait: async (ms) => { waits.push(ms); if (!pages.length) controller.abort(); },
  });
  assert.deepEqual(output, [formatLogLine(a), formatLogLine(b)]);
  assert.deepEqual(waits, [1000, 2000, 4000, 1000]);
});

test("follow retries transient errors after a successful read, then recovers", async () => {
  const controller = new AbortController();
  let reads = 0;
  const output = [];
  const warnings = [];
  const waits = [];
  await runServiceLogs({ ...flags, follow: true }, clientFor(async () => {
    if (++reads === 2) throw new LogsRequestError("temporary", true);
    return page(reads === 1 ? [a] : [a, b]);
  }), {
    signal: controller.signal, write: (s) => output.push(s), warn: (s) => warnings.push(s),
    wait: async (ms) => { waits.push(ms); if (reads === 3) controller.abort(); },
  });
  assert.equal(output.length, 2);
  assert.deepEqual(waits, [1000, 2000, 1000]);
  assert.match(warnings[0], /Retrying/);
});

test("follow stops after five failed retries and caps backoff", async () => {
  let reads = 0;
  const waits = [];
  await assert.rejects(runServiceLogs({ ...flags, follow: true }, clientFor(async () => {
    if (++reads > 1) throw new LogsRequestError("temporary", true);
    return page([a]);
  }), { write: () => {}, warn: () => {}, wait: async (ms) => { waits.push(ms); } }), /temporary/);
  assert.equal(reads, 7);
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 10000, 10000]);
});

test("initial errors and expired sessions fail without polling", async () => {
  for (const error of [new LogsRequestError("Not logged in", false), new LogsRequestError("unavailable", true)]) {
    await assert.rejects(runServiceLogs({ ...flags, follow: true }, clientFor(async () => { throw error; }), {
      wait: async () => assert.fail("must not wait"),
    }), error);
  }
});

test("HTTP client uses dashboard API, encodes session and passes bounded options", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "http://localhost:3026");
    assert.equal(parsed.pathname, "/api/services/logs/recent");
    assert.equal(parsed.searchParams.get("service"), "id & /?");
    assert.equal(parsed.searchParams.get("lines"), "5");
    assert.equal(parsed.searchParams.get("since"), "6h");
    assert.equal(Buffer.from(init.headers.Authorization.slice(7), "base64url").toString(), "session=fixture");
    assert.equal(init.redirect, "manual");
    return Response.json(page([a]));
  });
  const client = createLogsClient({ ...defaultConfig(), dashboardPort: 3026 }, { cookie: "session=fixture", request: async () => [] });
  assert.deepEqual(await client.readLogs("id & /?", { lines: 5, since: "6h" }), page([a]));
});

for (const [status, message, retryable] of [[401, /Not logged in/, false], [307, /Not logged in/, false],
  [403, /inaccessible/, false], [404, /Unknown/, false], [429, /429/, true], [503, /503/, true]]) {
  test(`HTTP client reports ${status}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("", { status }));
    const client = createLogsClient(defaultConfig(), { cookie: "session=fixture", request: async () => [] });
    await assert.rejects(client.readLogs("s1", {}), (error) => {
      assert.match(error.message, message);
      assert.equal(error.retryable, retryable);
      return true;
    });
  });
}

test("shared auth cancels in-flight login cleanly", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (!url.endsWith("/sign-in/email")) return new Response("");
    controller.abort();
    init.signal.throwIfAborted();
  });
  await assert.rejects(connectPlatformClient({ ...defaultConfig(), adminEmail: "test@example.invalid", adminPassword: "fixture-only" }, controller.signal), { name: "AbortError" });
});

test("real SIGINT exits follow with code 0 and removes its listener", async () => {
  const source = `
    import { withLogsInterrupt, runServiceLogs } from ${JSON.stringify(new URL("../dist/lib.js", import.meta.url).href)};
    const before = process.listenerCount('SIGINT');
    await withLogsInterrupt(async signal => {
      const client = { request: async () => ${JSON.stringify([project])}, readLogs: async () => (${JSON.stringify(page([a]))}) };
      await runServiceLogs({ service: 'web', follow: true }, client, { signal, write: () => console.log('ready') });
    });
    if (process.listenerCount('SIGINT') !== before) process.exitCode = 1;
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  const completed = once(child, "exit");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    await once(child.stdout, "data");
    child.kill("SIGINT");
    const [code, signal] = await completed;
    assert.equal(code, 0);
    assert.equal(signal, null);
  } finally { clearTimeout(timer); child.kill(); }
});

test("interrupted response bodies are retryable", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error("connection reset")); },
  })));
  const client = createLogsClient(defaultConfig(), { cookie: "session=fixture", request: async () => [] });
  await assert.rejects(client.readLogs("s1", {}), (error) => {
    assert.match(error.message, /interrupted/);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("remote-server services report the unsupported case clearly", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 422 }));
  const client = createLogsClient(defaultConfig(), { cookie: "session=fixture", request: async () => [] });
  await assert.rejects(client.readLogs("s1", {}), /remote servers are not supported/);
});
