import { describe, expect, it } from "vitest";
import {
  filterLogs,
  formatLogJson,
  MAX_LOG_LINE_LENGTH,
  MAX_LOG_LINES,
  mergeLogs,
  parseLogLine,
  type LogSource,
} from "./log-explorer";

const a: LogSource = { id: "a", name: "logx-a", appName: "logx-a" };
const b: LogSource = { id: "b", name: "logx-b", appName: "logx-b" };
const start = Date.parse("2026-10-26T12:00:00Z");
const line = (offset: number, text: string) => `${new Date(start + offset).toISOString()} ${text}`;

describe("parseLogLine", () => {
  it("uses Docker timestamps over JSON timestamps and preserves expandable objects", () => {
    const json = { level: "ERROR", timestamp: "2000-01-01T00:00:00Z", message: "failed", nested: { retry: true } };
    const entry = parseLogLine(`2026-10-26T12:00:00.123456789Z ${JSON.stringify(json)}`, a);
    expect(entry).toMatchObject({ sourceId: "a", serviceName: "logx-a", ts: start + 123, subMillisecondNanos: 456789, level: "error", json, truncated: false });
    expect(entry.text).toBe(JSON.stringify(json));
  });

  it.each([
    [10, "debug"], [20, "debug"], [30, "info"], [40, "warn"], [50, "error"], [60, "error"],
    ["30", "info"], ["warning", "warn"], ["FATAL", "error"], ["trace", "debug"], ["notice", "info"],
    [999, "unknown"], ["custom", "unknown"], [null, "unknown"],
  ])("infers JSON level %s as %s", (level, expected) => {
    expect(parseLogLine(JSON.stringify({ level, message: "event" }), a).level).toBe(expected);
  });

  it.each([
    ["ERROR: failed", "error"], ["[WARN] retry", "warn"], ["(INFO) ready", "info"],
    ["debug - details", "debug"], ["fatal crash", "error"], ["ERR failed", "error"],
    ["2026-10-26 12:00:00,123 WARNING retry", "warn"], ["[12:00:00] TRACE detail", "debug"],
    ["\u001b[31m[ERROR]\u001b[0m failed", "error"], ["information only", "unknown"],
    ["request included error text", "unknown"],
  ])("infers common prefixes in %s", (text, expected) => {
    expect(parseLogLine(line(0, text), a).level).toBe(expected);
  });

  it("uses JSON timestamps only when Docker did not supply one", () => {
    expect(parseLogLine(JSON.stringify({ time: start }), a).ts).toBe(start);
    expect(parseLogLine(JSON.stringify({ ts: start / 1000 }), a).ts).toBe(start);
    expect(parseLogLine(JSON.stringify({ timestamp: "2026-10-26T12:00:00Z" }), a).ts).toBe(start);
    expect(parseLogLine(JSON.stringify({ timestamp: "invalid", time: start }), a).ts).toBe(start);
  });

  it("retains arrays for expansion and leaves malformed JSON and unclassified text readable", () => {
    expect(parseLogLine('[{"message":"one"},2]', a)).toMatchObject({ json: [{ message: "one" }, 2], level: "unknown", ts: null });
    const malformed = parseLogLine('{"level":"error",', a);
    expect(malformed).toMatchObject({ text: '{"level":"error",', level: "unknown", ts: null });
    expect(malformed.json).toBeUndefined();
    expect(parseLogLine("plain message", a).level).toBe("unknown");
  });

  it("bounds lines before JSON parsing and marks truncation", () => {
    const text = "x".repeat(MAX_LOG_LINE_LENGTH + 10_000);
    const entry = parseLogLine(line(0, text), a);
    expect(entry.text).toHaveLength(MAX_LOG_LINE_LENGTH);
    expect(entry.truncated).toBe(true);
    expect(entry.ts).toBe(start);
    const json = parseLogLine(JSON.stringify({ level: "error", message: text }), a);
    expect(json.text).toHaveLength(MAX_LOG_LINE_LENGTH);
    expect(json.truncated).toBe(true);
    expect(json.json).toBeUndefined();
    expect(parseLogLine(line(0, "x".repeat(MAX_LOG_LINE_LENGTH)), a).truncated).toBe(false);
  });
});

describe("mergeLogs", () => {
  it("interleaves services by timestamp and includes the time-window boundary", () => {
    const entries = mergeLogs([
      { source: a, lines: [line(3000, "a-late"), line(-1, "old"), line(0, "a-first")] },
      { source: b, lines: [line(2000, "b-middle"), line(4000, "b-late")] },
    ], { since: start });
    expect(entries.map((entry) => entry.text)).toEqual(["a-first", "b-middle", "a-late", "b-late"]);
    expect(entries.map((entry) => entry.sourceId)).toEqual(["a", "b", "a", "b"]);
  });

  it("preserves identical events and stable IDs across shifted tail windows", () => {
    const duplicate = line(1000, "same");
    const first = mergeLogs([{ source: a, lines: [line(0, "old"), duplicate, duplicate] }], { since: start });
    const next = mergeLogs([{ source: a, lines: [duplicate, duplicate, line(2000, "new")] }], { since: start });
    expect(first.slice(1).map((entry) => entry.id)).toEqual(next.slice(0, 2).map((entry) => entry.id));
    expect(new Set(first.map((entry) => entry.id)).size).toBe(3);
    expect(parseLogLine(duplicate, a).id).not.toBe(parseLogLine(duplicate, b).id);
    expect(parseLogLine("2026-10-26T12:00:00.123000001Z same", a).id)
      .not.toBe(parseLogLine("2026-10-26T12:00:00.123000002Z same", a).id);
  });

  it("interleaves Docker timestamps within the same millisecond at nanosecond precision", () => {
    const batches = [
      { source: a, lines: ["2026-10-26T12:00:00.123999999Z latest"] },
      { source: b, lines: [
        "2026-10-26T12:00:00.123000001Z first-nanosecond",
        "2026-10-26T12:00:00.123Z whole-millisecond",
        "2026-10-26T12:00:00.1235Z middle",
      ] },
    ];
    const entries = mergeLogs(batches, { since: start });
    expect(entries.map((entry) => entry.text)).toEqual(["whole-millisecond", "first-nanosecond", "middle", "latest"]);
    expect(entries.map((entry) => entry.ts)).toEqual(Array(4).fill(start + 123));
    expect(mergeLogs(batches, { since: start, limit: 1 }).map((entry) => entry.text)).toEqual(["latest"]);
  });

  it("normalizes offsets before comparing nanoseconds and preserves exact timestamp ties", () => {
    const entries = mergeLogs([
      { source: a, lines: ["2026-10-26T12:00:00.123999999Z a-later"] },
      { source: b, lines: ["2026-10-26T08:00:00.123000001-04:00 b-earlier", "2026-10-26T08:00:00.123999999-04:00 b-tie"] },
    ], { since: start });
    expect(entries.map((entry) => entry.text)).toEqual(["b-earlier", "a-later", "b-tie"]);
  });

  it("retains only the newest bounded entries even when input is unsorted", () => {
    const lines = Array.from({ length: MAX_LOG_LINES + 100 }, (_, i) => line(i, `event-${i}`)).reverse();
    const entries = mergeLogs([{ source: a, lines }], { since: start, limit: MAX_LOG_LINES + 100 });
    expect(entries).toHaveLength(MAX_LOG_LINES);
    expect(entries[0].text).toBe("event-100");
    expect(entries.at(-1)?.text).toBe(`event-${MAX_LOG_LINES + 99}`);
    expect(mergeLogs([{ source: a, lines }], { since: start, limit: 2 }).map((entry) => entry.text))
      .toEqual([`event-${MAX_LOG_LINES + 98}`, `event-${MAX_LOG_LINES + 99}`]);
    expect(mergeLogs([{ source: a, lines }], { since: start, limit: 0 })).toEqual([]);
    expect(mergeLogs([{ source: a, lines }], { since: start, limit: -1 })).toEqual([]);
  });

  it("keeps undated lines visible first and orders equal timestamps deterministically", () => {
    const entries = mergeLogs([
      { source: a, lines: [line(0, "a-first"), "undated", line(0, "a-second")] },
      { source: b, lines: [line(0, "b-first")] },
    ], { since: start });
    expect(entries.map((entry) => entry.text)).toEqual(["undated", "a-first", "a-second", "b-first"]);
  });
});

describe("filterLogs", () => {
  const entries = mergeLogs([
    { source: a, lines: [line(0, "ERROR failed request"), line(1000, "INFO ready"), "unclassified"] },
    { source: b, lines: [line(2000, '{"level":"warn","message":"Failed retry"}'), line(3000, "DEBUG request details")] },
  ], { since: start });

  it("combines multi-service, multi-level, case-insensitive search and time filters", () => {
    expect(filterLogs(entries, { serviceIds: ["a", "b"], levels: ["error", "warn"], search: " FAILED ", since: start + 1 }))
      .toEqual([entries[3]]);
    expect(filterLogs(entries, { serviceIds: ["a"], levels: ["error", "info"] }).map((entry) => entry.text))
      .toEqual(["ERROR failed request", "INFO ready"]);
    expect(filterLogs(entries, { search: '"message"' })).toEqual([entries[3]]);
  });

  it("distinguishes omitted filters from empty selections and preserves unknown levels", () => {
    expect(filterLogs(entries, {})).toEqual(entries);
    expect(filterLogs(entries, { serviceIds: [] })).toEqual([]);
    expect(filterLogs(entries, { levels: [] })).toEqual([]);
    expect(filterLogs(entries, { search: "   " })).toEqual(entries);
    expect(filterLogs(entries, { levels: ["unknown"] })).toEqual([entries[0]]);
  });

  it("includes time boundaries and undated lines without mutating the input", () => {
    const before = entries.map((entry) => ({ ...entry }));
    expect(filterLogs(entries, { since: start + 3000 })).toEqual([entries[0], entries[4]]);
    expect(entries).toEqual(before);
  });
});

describe("formatLogJson", () => {
  it("pretty-prints ordinary nested objects and arrays without changing values", () => {
    const value = { message: "ready", details: { attempts: [1, 2], healthy: true, missing: null } };
    expect(formatLogJson(value)).toBe(JSON.stringify(value, null, 2));
  });

  it("elides excessive depth instead of expanding deeply nested input", () => {
    const text = "[".repeat(2000) + '"deep"' + "]".repeat(2000);
    const entry = parseLogLine(text, a);
    const formatted = formatLogJson(entry.json);
    expect(formatted).toContain("maximum JSON depth reached");
    expect(formatted.length).toBeLessThan(1000);
    expect(formatted).not.toContain('"deep"');
  });

  it("caps pretty output and marks omitted characters", () => {
    const value = { message: "x".repeat(40_000) };
    const formatted = formatLogJson(value);
    expect(formatted).toHaveLength(32_768);
    expect(formatted.endsWith("… formatted JSON truncated")).toBe(true);
  });

  it("makes circular references explicit if called with a non-JSON object", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(formatLogJson(value)).toContain("circular reference");
  });
});
