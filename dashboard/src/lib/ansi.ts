export interface AnsiStyle {
  color?: string;
  backgroundColor?: string;
  fontWeight?: 700;
  opacity?: number;
  fontStyle?: "italic";
  textDecoration?: "underline";
}

export interface AnsiSpan {
  text: string;
  style: AnsiStyle;
}

export interface ParsedAnsi {
  text: string;
  spans: AnsiSpan[];
}

// Brighter than the traditional terminal palette to remain legible on dark logs.
const PALETTE = [
  "#6b7280", "#f87171", "#4ade80", "#facc15",
  "#60a5fa", "#c084fc", "#22d3ee", "#d4d4d8",
  "#9ca3af", "#fca5a5", "#86efac", "#fde047",
  "#93c5fd", "#d8b4fe", "#67e8f9", "#fafafa",
];

function indexedColor(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return;
  if (index < 16) return PALETTE[index];
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  const cube = index - 16;
  const channel = (value: number) => value === 0 ? 0 : 55 + value * 40;
  return `rgb(${channel(Math.floor(cube / 36))}, ${channel(Math.floor(cube / 6) % 6)}, ${channel(cube % 6)})`;
}

function applySgr(style: AnsiStyle, parameters: string): AnsiStyle {
  // Only accept numeric SGR parameters; log contents can never become CSS values.
  if (!/^[\d;]*$/.test(parameters)) return style;
  const fields = parameters.split(";");
  const codes = fields.map(Number);
  let next = { ...style };
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index];
    if (code === 0) next = {};
    else if (code === 1) next.fontWeight = 700;
    else if (code === 2) next.opacity = 0.65;
    else if (code === 3) next.fontStyle = "italic";
    else if (code === 4) next.textDecoration = "underline";
    else if (code === 22) {
      delete next.fontWeight;
      delete next.opacity;
    } else if (code === 23) delete next.fontStyle;
    else if (code === 24) delete next.textDecoration;
    else if (code === 39) delete next.color;
    else if (code === 49) delete next.backgroundColor;
    else if (code >= 30 && code <= 37) next.color = PALETTE[code - 30];
    else if (code >= 90 && code <= 97) next.color = PALETTE[code - 90 + 8];
    else if (code >= 40 && code <= 47) next.backgroundColor = PALETTE[code - 40];
    else if (code >= 100 && code <= 107) next.backgroundColor = PALETTE[code - 100 + 8];
    else if (code === 38 || code === 48) {
      const property = code === 38 ? "color" : "backgroundColor";
      const mode = codes[++index];
      if (mode === 5) {
        const color = indexedColor(codes[++index]);
        if (color && fields[index] !== "") next[property] = color;
      } else if (mode === 2) {
        const components = fields.slice(index + 1, index + 4);
        const rgb = codes.slice(index + 1, index + 4);
        index += 3;
        if (rgb.length === 3 && components.every((value) => value !== "")
          && rgb.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
          next[property] = `rgb(${rgb.join(", ")})`;
        }
      } else {
        // Unknown extended color formats must not reinterpret their payload as SGR.
        break;
      }
    }
  }
  return next;
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return a.color === b.color && a.backgroundColor === b.backgroundColor
    && a.fontWeight === b.fontWeight && a.opacity === b.opacity
    && a.fontStyle === b.fontStyle && a.textDecoration === b.textDecoration;
}

/** Parse log text into inert spans. Callers can memoize each line independently. */
export function parseAnsi(input: string): ParsedAnsi {
  const spans: AnsiSpan[] = [];
  let style: AnsiStyle = {};
  let lineStart = 0;
  let overwrite = false;
  let start = 0;
  let index = 0;

  function append(text: string, replace = true) {
    if (!text) return;
    if (overwrite && replace) {
      spans.length = lineStart;
      overwrite = false;
    }
    const last = spans[spans.length - 1];
    if (spans.length > lineStart && sameStyle(last.style, style)) last.text += text;
    else spans.push({ text, style: { ...style } });
  }

  while (index < input.length) {
    const code = input.charCodeAt(index);
    if (code === 13 || code === 10) {
      append(input.slice(start, index));
      if (code === 10 || input.charCodeAt(index + 1) === 10) {
        append("\n", false);
        overwrite = false;
        lineStart = spans.length;
        index += code === 13 ? 2 : 1;
      } else {
        // A trailing CR only moves the cursor; erase once replacement text arrives.
        overwrite = true;
        index++;
      }
      start = index;
    } else if (code === 27 || code === 0x9b || code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
      append(input.slice(start, index));
      const introducer = code === 27 ? input.charCodeAt(++index) : code;
      index++;
      if (introducer === 91 || introducer === 0x9b) {
        const parametersStart = index;
        // CSI consists of parameter/intermediate bytes followed by one final byte.
        while (index < input.length && input.charCodeAt(index) >= 0x20 && input.charCodeAt(index) <= 0x3f) index++;
        const final = input.charCodeAt(index);
        if (final >= 0x40 && final <= 0x7e) {
          if (final === 109) style = applySgr(style, input.slice(parametersStart, index));
          index++;
        }
      } else if (introducer === 93 || introducer === 0x9d || introducer === 80 || introducer === 0x90
        || introducer === 88 || introducer === 0x98 || introducer === 94 || introducer === 0x9e || introducer === 95 || introducer === 0x9f) {
        const osc = introducer === 93 || introducer === 0x9d;
        while (index < input.length) {
          const current = input.charCodeAt(index);
          if ((osc && current === 7) || current === 0x9c) {
            index++;
            break;
          }
          if (current === 27 && input[index + 1] === "\\") {
            index += 2;
            break;
          }
          // Recover from a truncated control string at the next log line.
          if (current === 10 || current === 13) break;
          index++;
        }
      } else if (code === 27) {
        // Strip other escape sequences (e.g. save cursor and character sets).
        index--;
        while (index < input.length && input.charCodeAt(index) >= 0x20 && input.charCodeAt(index) <= 0x2f) index++;
        if (input.charCodeAt(index) >= 0x30 && input.charCodeAt(index) <= 0x7e) index++;
      }
      start = index;
    } else if ((code < 32 && code !== 9) || (code >= 0x7f && code <= 0x9f)) {
      append(input.slice(start, index));
      start = ++index;
    } else {
      index++;
    }
  }
  append(input.slice(start));
  return { text: spans.map((span) => span.text).join(""), spans };
}

/** Plain text for log search, copying and downloads, with the same progress handling. */
export function stripAnsi(input: string): string {
  return parseAnsi(input).text;
}
