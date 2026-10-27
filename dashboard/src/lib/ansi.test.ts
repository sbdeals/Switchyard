import { describe, expect, it } from "vitest";
import { parseAnsi, stripAnsi } from "./ansi";

const ESC = "\u001b";
const sgr = (codes: string) => `${ESC}[${codes}m`;

describe("parseAnsi", () => {
  it("preserves plain text, whitespace, Unicode, and empty input", () => {
    expect(parseAnsi("")).toEqual({ text: "", spans: [] });
    const text = "  hello\t世界 🌈\nnext line";
    expect(parseAnsi(text).text).toBe(text);
    expect(parseAnsi("hello").spans).toEqual([{ text: "hello", style: {} }]);
  });

  it("layers SGR styles and selectively resets without changing earlier spans", () => {
    const parsed = parseAnsi(`${sgr("31")}red${sgr("1;2;3;4;44")}styled${sgr("22;23;24;39")}blue background${sgr("49")}plain`);
    expect(parsed.text).toBe("redstyledblue backgroundplain");
    expect(parsed.spans).toEqual([
      { text: "red", style: { color: "#f87171" } },
      { text: "styled", style: { color: "#f87171", backgroundColor: "#60a5fa", fontWeight: 700, opacity: 0.65, fontStyle: "italic", textDecoration: "underline" } },
      { text: "blue background", style: { backgroundColor: "#60a5fa" } },
      { text: "plain", style: {} },
    ]);
  });

  it.each(["0", "", "0;0"])("resets all styles with SGR %j", (reset) => {
    expect(parseAnsi(`${sgr("1;2;3;4;31;44")}styled${sgr(reset)}plain`).spans[1]).toEqual({ text: "plain", style: {} });
  });

  it("treats empty SGR parameters as reset and repeated styles as a single span", () => {
    expect(parseAnsi(`${sgr("31")}a${sgr("31")}b${sgr("999")}c`).spans).toEqual([{ text: "abc", style: { color: "#f87171" } }]);
    expect(parseAnsi(`${sgr("31;;1")}bold`).spans).toEqual([{ text: "bold", style: { fontWeight: 700 } }]);
  });

  it.each(Array.from({ length: 8 }, (_, index) => index))("supports normal and bright foreground/background color %i", (index) => {
    const normal = parseAnsi(`${sgr(String(30 + index))}x`).spans[0].style.color;
    const bright = parseAnsi(`${sgr(String(90 + index))}x`).spans[0].style.color;
    expect(normal).toMatch(/^#[\da-f]{6}$/);
    expect(bright).toMatch(/^#[\da-f]{6}$/);
    expect(bright).not.toBe(normal);
    expect(parseAnsi(`${sgr(String(40 + index))}x`).spans[0].style.backgroundColor).toBe(normal);
    expect(parseAnsi(`${sgr(String(100 + index))}x`).spans[0].style.backgroundColor).toBe(bright);
  });

  it.each([
    [0, "#6b7280"], [15, "#fafafa"], [16, "rgb(0, 0, 0)"],
    [21, "rgb(0, 0, 255)"], [196, "rgb(255, 0, 0)"], [231, "rgb(255, 255, 255)"],
    [232, "rgb(8, 8, 8)"], [255, "rgb(238, 238, 238)"],
  ])("supports indexed foreground and background %i", (index, color) => {
    expect(parseAnsi(`${sgr(`38;5;${index};48;5;${index}`)}x`).spans[0].style).toEqual({ color, backgroundColor: color });
  });

  it("supports truecolor, combined attributes, and selective color resets", () => {
    expect(parseAnsi(`${sgr("1;38;2;12;34;56;48;2;255;0;128")}color${sgr("39;49")}bold`).spans).toEqual([
      { text: "color", style: { fontWeight: 700, color: "rgb(12, 34, 56)", backgroundColor: "rgb(255, 0, 128)" } },
      { text: "bold", style: { fontWeight: 700 } },
    ]);
  });

  it.each(["38;5;256", "48;5;999999999999999999999999999", "38;2;256;0;0", "48;2;1;2", "38;5", "38;5;", "48;2;;1;2", "38;2;1;;2", "38;2;1;2;", "48", "38;9;31", "38:2:1:2:3", "38;-1;31"])("ignores invalid or incomplete color parameters %j", (codes) => {
    expect(parseAnsi(`${sgr(codes)}safe`).spans).toEqual([{ text: "safe", style: {} }]);
  });

  it("strips CSI cursor moves, erase commands, private modes, and intermediate bytes", () => {
    const text = `a${ESC}[2Jb${ESC}[1;1Hc${ESC}[?25ld${ESC}[0 qe${ESC}[4Af`;
    expect(parseAnsi(text)).toEqual({ text: "abcdef", spans: [{ text: "abcdef", style: {} }] });
  });

  it("strips OSC hyperlinks and titles terminated by BEL, ST, or C1 ST", () => {
    const text = `${ESC}]0;secret title\u0007before ${ESC}]8;;https://example.test${ESC}\\link${ESC}]8;;${ESC}\\ after${ESC}]2;another title\u009c`;
    expect(parseAnsi(text)).toEqual({ text: "before link after", spans: [{ text: "before link after", style: {} }] });
  });

  it("supports C1 CSI and OSC without retaining control bytes", () => {
    expect(parseAnsi("\u009b32mgreen\u009b0m\u009d8;;https://example.test\u009c label\u009d8;;\u009c").spans).toEqual([
      { text: "green", style: { color: "#4ade80" } },
      { text: " label", style: {} },
    ]);
  });

  it("strips other escape sequences, control strings, and nonprinting controls", () => {
    expect(stripAnsi(`a${ESC}7b${ESC}(Bc${ESC}Pprivate payload${ESC}\\d${ESC}_payload${ESC}\\e\u0000\u0007\u007f`)).toBe("abcde");
  });

  it.each([ESC, `${ESC}[`, `${ESC}[31;`, `${ESC}]`, `${ESC}]8;;https://example.test`, `${ESC}]title${ESC}`, `${ESC}Ppayload`])("drops truncated sequence %j", (sequence) => {
    expect(stripAnsi(`visible${sequence}`)).toBe("visible");
  });

  it("recovers malformed and truncated sequences at a newline or invalid byte", () => {
    expect(stripAnsi(`before${ESC}[31;\nafter`)).toBe("before\nafter");
    expect(stripAnsi(`before${ESC}]unterminated\nafter`)).toBe("before\nafter");
    expect(stripAnsi(`${ESC}[31💚text`)).toBe("💚text");
    expect(stripAnsi(`a${ESC}\nb`)).toBe("a\nb");
  });

  it.each([
    ["loading 10%\rloading 90%\rdone", "done"],
    ["hello\r", "hello"],
    ["first\rsecond\r", "second"],
    ["first\r\rsecond", "second"],
    ["first\r\nsecond\r\n", "first\nsecond\n"],
    ["prior\nold\rnew\nlast", "prior\nnew\nlast"],
  ])("handles carriage returns in %j", (input, expected) => {
    expect(stripAnsi(input)).toBe(expected);
  });

  it("preserves styling across progress overwrites and trailing control sequences", () => {
    expect(parseAnsi(`${sgr("31")}old\rnew${sgr("1")}!\r${sgr("0")}`).spans).toEqual([
      { text: "new", style: { color: "#f87171" } },
      { text: "!", style: { color: "#f87171", fontWeight: 700 } },
    ]);
    expect(parseAnsi(`${sgr("32")}old\r${sgr("0")}new`).spans).toEqual([{ text: "new", style: {} }]);
  });

  it("preserves styles within multiline input without affecting other parse calls", () => {
    expect(parseAnsi(`${sgr("31")}first\nsecond`).spans.every((span) => span.style.color === "#f87171")).toBe(true);
    expect(parseAnsi("plain").spans[0].style).toEqual({});
  });

  it("keeps HTML-looking text and entities as inert text, including after OSC stripping", () => {
    const text = '<script>alert("x")</script><img src=x onerror=alert(1)>&lt;b&gt;';
    const parsed = parseAnsi(`${sgr("31")}${text}${ESC}]8;;javascript:alert(1)\u0007click${ESC}]8;;\u0007`);
    expect(parsed.text).toBe(`${text}click`);
    expect(parsed.spans).toEqual([{ text: `${text}click`, style: { color: "#f87171" } }]);
  });

  it("produces identical plain text for search, copy, and download", () => {
    const input = `${sgr("31")}err${sgr("1")}or${sgr("0")}: <failure>\r${sgr("32")}recovered`;
    const parsed = parseAnsi(input);
    expect(stripAnsi(input)).toBe("recovered");
    expect(parsed.spans.map((span) => span.text).join("")).toBe(stripAnsi(input));
  });

  it("parses 10,000 realistic colored log lines within two seconds", () => {
    const lines = Array.from({ length: 10_000 }, (_, index) =>
      `${sgr("2")}2026-10-26T12:00:00Z${sgr("0")} ${sgr("1;32")}INFO${sgr("0")} request ${index}: ${sgr("38;5;208")}colored${sgr("0")} ${ESC}]8;;https://example.test${ESC}\\link${ESC}]8;;${ESC}\\`);
    const started = performance.now();
    const parsed = lines.map(parseAnsi);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(parsed).toHaveLength(10_000);
    expect(parsed[9_999].text).toBe("2026-10-26T12:00:00Z INFO request 9999: colored link");
  });

  it("handles long malformed sequences without backtracking", () => {
    const input = `visible${ESC}[${";".repeat(200_000)}\n${ESC}]${"x".repeat(200_000)}`;
    const started = performance.now();
    expect(stripAnsi(input)).toBe("visible\n");
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
