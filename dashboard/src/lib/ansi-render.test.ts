import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseAnsi } from "./ansi";
import { AnsiText } from "../components/service/AnsiText";

vi.mock("@/lib/ansi", () => import("./ansi"));

describe("ANSI log rendering", () => {
  it("renders the same spans for parsed runtime lines and raw console output", () => {
    const value = "plain \x1b[1;31mbold red\x1b[0m reset";
    const runtime = renderToStaticMarkup(createElement(AnsiText, { value: parseAnsi(value) }));
    const consoleOutput = renderToStaticMarkup(createElement(AnsiText, { value }));
    expect(runtime).toBe(consoleOutput);
    expect(runtime).toContain("font-weight:700");
    expect(runtime).toContain("color:");
    expect(runtime).not.toContain("\x1b");
  });

  it("keeps HTML and OSC hyperlink labels as inert text", () => {
    const value = '\x1b]8;;javascript:alert(1)\x07<script>alert("log")</script>\x1b]8;;\x07';
    const html = renderToStaticMarkup(createElement(AnsiText, { value }));
    expect(html).toContain("&lt;script&gt;alert(&quot;log&quot;)&lt;/script&gt;");
    expect(html).not.toMatch(/<script|<a |href=|javascript:|\x1b/);
  });

  it("keeps filtering and copied text independent of color boundaries and overwritten progress", () => {
    const line = parseAnsi("old progress\r\x1b[32mbuild\x1b[0m complete");
    expect(line.text.toLowerCase().includes("build complete")).toBe(true);
    expect(line.text.includes("old progress")).toBe(false);
    const html = renderToStaticMarkup(createElement(AnsiText, { value: line }));
    expect(html.replace(/<[^>]*>/g, "")).toBe(line.text);
  });
});
