import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServiceIcon } from "../components/ServiceIcon";
import { ENGINE_META } from "./engines";
import type { ServiceIconKind } from "./service-icon";

const ICONS: [ServiceIconKind, string][] = [
  ["postgres", "PostgreSQL"],
  ["mysql", "MySQL"],
  ["mariadb", "MariaDB"],
  ["mongo", "MongoDB"],
  ["redis", "Redis"],
  ["nginx", "NGINX"],
  ["node", "Node.js"],
  ["python", "Python"],
  ["traefik", "Traefik"],
  ["whoami", "whoami"],
  ["github", "GitHub"],
  ["compose", "Compose stack"],
  ["database", "Database"],
  ["application", "Application"],
];

function render(icon: ServiceIconKind, accent = "#a06bff") {
  return renderToStaticMarkup(createElement(ServiceIcon, { icon, accent }));
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(channels: number[]): number {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

describe("ServiceIcon", () => {
  it.each(ICONS)("prefers an exact catalog match over the %s badge", (icon) => {
    const markup = renderToStaticMarkup(createElement(ServiceIcon, {
      icon,
      logo: "https://catalog.example/supabase.svg",
      logoLabel: "Supabase",
      accent: "#a06bff",
    }));
    expect(markup).toContain('<img src="https://catalog.example/supabase.svg"');
    expect(markup).toContain('alt="Supabase logo"');
    expect(markup).toContain('title="Supabase logo"');
    expect(markup).not.toContain("<svg");
  });

  it.each(ICONS)("renders an accessible local SVG for %s", (icon, label) => {
    const markup = render(icon);
    expect(markup).toMatch(/<svg\b[^>]*role="img"/);
    expect(markup).toContain(`aria-label="${label}"`);
    expect(markup).toContain(`<title>${label}</title>`);
    expect(markup).not.toContain('aria-hidden="true"');
    expect(markup).not.toMatch(/<(?:img|image)\b|(?:href|src)=|url\(/);
  });

  it.each([
    ["canvas node", undefined, undefined, "size-9", "rounded-lg"],
    ["service card", "size-10", undefined, "size-10", "rounded-lg"],
    ["drawer header", "size-11", "rounded-xl", "size-11", "rounded-xl"],
  ])("preserves the %s wrapper dimensions", (_surface, size, rounded, expectedSize, expectedRounded) => {
    const markup = renderToStaticMarkup(createElement(ServiceIcon, {
      icon: "nginx",
      accent: "#a06bff",
      size,
      rounded,
    }));
    const wrapperClass = /^<div class="([^"]+)"/.exec(markup)?.[1].split(" ");
    expect(wrapperClass).toContain(expectedSize);
    expect(wrapperClass).toContain(expectedRounded);
    expect(wrapperClass).toContain("shrink-0");
  });

  it.each([
    ["application", "lucide-box"],
    ["database", "lucide-database"],
    ["compose", "lucide-layers"],
  ] as const)("retains the existing generic glyph for %s", (icon, glyphClass) => {
    expect(render(icon)).toContain(glyphClass);
  });

  it.each(ICONS)("keeps %s legible on the dark theme's tinted surfaces", (icon) => {
    const surface = rgb("#16161f");
    const accents = ["#a06bff", "#2dd4bf", ...Object.values(ENGINE_META).map((engine) => engine.accent)];
    for (const accent of accents) {
      const markup = render(icon, accent);
      const color = /(?:;|\")color:(#[a-f0-9]{6})/i.exec(markup)?.[1];
      expect(color).toBeDefined();
      expect(markup).toContain(`background-color:${accent}1a`);
      const alpha = 0x1a / 255;
      const background = rgb(accent).map((channel, index) => channel * alpha + surface[index] * (1 - alpha));
      const foregroundLuminance = luminance(rgb(color!));
      const backgroundLuminance = luminance(background);
      const contrast = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      const minimum = markup.includes("<text") ? 4.5 : 3;
      expect(contrast, `${icon} on ${accent} tint`).toBeGreaterThanOrEqual(minimum);
    }
  });
});
