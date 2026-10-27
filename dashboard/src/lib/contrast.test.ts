import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";

describe("WCAG contrast", () => {
  it("calculates known luminance and contrast values", () => {
    expect(relativeLuminance("#000")).toBe(0);
    expect(relativeLuminance("#fff")).toBe(1);
    expect(relativeLuminance("#ff0000")).toBeCloseTo(0.2126);
    expect(relativeLuminance("#0a0a0a")).toBeCloseTo(10 / 255 / 12.92);
    expect(contrastRatio("#000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#fff", "#000")).toBe(21);
    expect(contrastRatio("#777", "#777777")).toBe(1);
    expect(contrastRatio("#777", "#fff")).toBeCloseTo(4.478, 3);
  });

  it.each(["red", "ffffff", "#ggg", "#12", "#12345", "#1234", "#ffffff80", " #fff"])(
    "rejects invalid or non-opaque colors: %s",
    (value) => expect(() => contrastRatio(value, "#fff")).toThrow("opaque"),
  );
});

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const lightBlock = css.match(/\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1];
if (!lightBlock) throw new Error("Missing light theme tokens");
const light = Object.fromEntries(
  [...lightBlock.matchAll(/--color-([\w-]+):\s*(#[\da-f]+);/gi)].map((match) => [match[1], match[2]]),
);
const backgrounds = ["bg", "bg-elevated", "surface", "surface-hover", "code-bg"];
const textColors = ["fg", "fg-muted", "fg-subtle", "brand", "ok", "warn", "danger", "idle", "info", "teal", "violet"];

describe("light theme tokens", () => {
  it.each(textColors.flatMap((foreground) => backgrounds.map((background) => [foreground, background])))(
    "%s on %s meets WCAG AA for normal text",
    (foreground, background) => {
      expect(contrastRatio(light[foreground], light[background])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["brand-strong", "brand-deep"])("white button text on %s meets WCAG AA", (background) => {
    expect(contrastRatio("#fff", light[background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(backgrounds)("control borders on %s meet WCAG non-text contrast", (background) => {
    expect(contrastRatio(light["border-control"], light[background])).toBeGreaterThanOrEqual(3);
  });
});
