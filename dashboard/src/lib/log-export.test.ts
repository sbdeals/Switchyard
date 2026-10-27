import { describe, expect, it } from "vitest";
import {
  capLogLines,
  formatVisibleLogs,
  logDownloadFilename,
  logDownloadStream,
  parseDockerLogLines,
  stripAnsi,
} from "./log-export";

const timestamp = "2026-10-26T12:34:56.000Z";
const ts = Date.parse(timestamp);
function frame(type: number, text: string | Buffer): Buffer {
  const body = Buffer.isBuffer(text) ? text : Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = type;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe("log export helpers", () => {
  it.each([null, undefined, "", "nope", "Infinity", "-1", "0", NaN])("defaults invalid line count %s to 5k", (value) => {
    expect(capLogLines(value)).toBe(5000);
  });

  it.each([1000, 5000, 10000])("accepts the %i line choice", (value) => {
    expect(capLogLines(String(value))).toBe(value);
  });

  it("caps excessive requests and normalizes fractional counts", () => {
    expect(capLogLines("999999999")).toBe(10000);
    expect(capLogLines("2.8")).toBe(2);
    expect(capLogLines("0.1")).toBe(1);
  });

  it("generates UTC filenames without path or header injection", () => {
    expect(logDownloadFilename("../my service/\r\n\"logs", "log", new Date(timestamp)))
      .toBe("my-service-logs-2026-10-26T12-34-56-000Z.log");
    expect(logDownloadFilename("...", "json", new Date(timestamp)))
      .toBe("service-2026-10-26T12-34-56-000Z.json");
    expect(logDownloadFilename("a".repeat(200), "log", new Date(timestamp)).split("-")[0]).toHaveLength(80);
  });

  it("strips styles, cursor controls, OSC links and titles, and C1 controls", () => {
    const text = "\x1b[31mred\x1b[0m \x1b[2Kclear \x1b]8;;https://example.test\x07link\x1b]8;;\x1b\\ \x1b]0;title\x07\x9b32mgreen\x9b0m";
    expect(stripAnsi(text)).toBe("red clear link green");
    expect(stripAnsi("plain Ω\nnext\tcolumn")).toBe("plain Ω\nnext\tcolumn");
  });

  it("formats only the visible lines with timestamps and no ANSI", () => {
    expect(formatVisibleLogs([{ ts, text: "\x1b[31mvisible\x1b[0m" }]))
      .toBe(`${timestamp} visible`);
    expect(formatVisibleLogs([])).toBe("");
  });

  it("strips two-byte cursor, reset, and keypad escapes", () => {
    expect(stripAnsi("\x1b7saved\x1b8 \x1bcreset \x1b=keypad\x1b>"))
      .toBe("saved reset keypad");
  });

  it("streams plain text without ANSI and JSON with timestamp and stream metadata", async () => {
    const lines = [{ ts, text: "\x1b[31merror\x1b[0m", stream: "stderr" as const }];
    const stream = logDownloadStream(lines, "log");
    expect(stream).toBeInstanceOf(ReadableStream);
    expect(await new Response(stream).text()).toBe(`${timestamp} error\n`);
    expect(await new Response(logDownloadStream(lines, "json")).json()).toEqual([
      { timestamp, text: lines[0].text, stream: "stderr" },
    ]);
    expect(await new Response(logDownloadStream([{ ts, text: "tty" }], "json")).json()).toEqual([
      { timestamp, text: "tty", stream: "unknown" },
    ]);
  });

  it("produces valid empty downloads", async () => {
    expect(await new Response(logDownloadStream([], "log")).text()).toBe("");
    expect(await new Response(logDownloadStream([], "json")).json()).toEqual([]);
  });
});

describe("Docker log records", () => {
  it("retains stdout/stderr and order across multiline frames", () => {
    const bytes = Buffer.concat([
      frame(1, `${timestamp} first\n${timestamp} second\n`),
      frame(2, `${timestamp} failed\n`),
      frame(1, `${timestamp} fourth\n`),
    ]);
    expect(parseDockerLogLines(bytes)).toEqual([
      { ts, text: "first", stream: "stdout" },
      { ts, text: "second", stream: "stdout" },
      { ts, text: "failed", stream: "stderr" },
      { ts, text: "fourth", stream: "stdout" },
    ]);
  });

  it("reassembles split lines and UTF8 without mixing stdout and stderr", () => {
    const encoded = Buffer.from(`${timestamp} café\n`);
    const split = encoded.indexOf(Buffer.from("é")) + 1;
    const bytes = Buffer.concat([
      frame(1, encoded.subarray(0, split)),
      frame(2, `${timestamp} warning\n`),
      frame(1, encoded.subarray(split)),
    ]);
    expect(parseDockerLogLines(bytes)).toEqual([
      { ts, text: "café", stream: "stdout" },
      { ts, text: "warning", stream: "stderr" },
    ]);
  });

  it("marks raw TTY logs unknown and keeps unterminated lines and invalid timestamps", () => {
    const bytes = Buffer.from(`${timestamp} tty\nno timestamp here`);
    expect(parseDockerLogLines(bytes, ts)).toEqual([
      { ts, text: "tty", stream: "unknown" },
      { ts, text: "no timestamp here", stream: "unknown" },
    ]);
    expect(parseDockerLogLines(Buffer.alloc(0))).toEqual([]);
  });

  it("retains blank timestamped log lines and the payload of a truncated frame", () => {
    const bytes = frame(1, `${timestamp} \n${timestamp} partial`);
    expect(parseDockerLogLines(bytes.subarray(0, bytes.length - 3))).toEqual([
      { ts, text: "", stream: "stdout" },
      { ts, text: "part", stream: "stdout" },
    ]);
  });
});
