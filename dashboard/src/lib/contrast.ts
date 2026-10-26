/** WCAG relative luminance for an opaque #rgb or #rrggbb color. */
export function relativeLuminance(hex: string): number {
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) {
    throw new Error(`Expected an opaque #rgb or #rrggbb color: ${hex}`);
  }
  const value = hex.length === 4
    ? [...hex.slice(1)].map((digit) => digit + digit).join("")
    : hex.slice(1);
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** WCAG contrast ratio, from 1:1 (identical) to 21:1 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
