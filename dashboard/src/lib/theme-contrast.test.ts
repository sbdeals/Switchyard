import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/--color-([\w-]+):\s*(#[\da-f]+);/g)]
  .map((match) => [match[1], match[2]]));

function rgb(hex: string) {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
}

function luminance(color: number[]) {
  return color.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(foreground: string, background: number[]) {
  const values = [luminance(rgb(foreground)), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("theme contrast", () => {
  it.each(["ok", "warn", "danger", "idle"])("keeps %s badge text readable on hovered service cards", (status) => {
    const soft = tokens[`${status}-soft`];
    const alpha = parseInt(soft.slice(7, 9), 16) / 255;
    const background = rgb(soft).map((channel, index) =>
      channel * alpha + rgb(tokens["surface-hover"])[index] * (1 - alpha));
    expect(contrast(tokens[status], background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["fg", "fg-muted", "fg-subtle"])("keeps %s text readable on the lightest surface", (token) => {
    expect(contrast(tokens[token], rgb(tokens["surface-hover"]))).toBeGreaterThanOrEqual(4.5);
  });
});
