// Shared by forms and server actions. No server-only imports or side effects.

// Dokploy uses node-schedule 2.1.1 / cron-parser 4.x. These are its macros
// (not @annually or @midnight); month/weekday aliases are three letters.
// https://github.com/harrisiirak/cron-parser/blob/4.9.0/lib/expression.js
const CRON_MACROS = new Set(["@hourly", "@daily", "@weekly", "@monthly", "@yearly"]);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const CRON_FIELDS = [
  { name: "second", min: 0, max: 59 },
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
];

export function validateCron(expression: string): string | null {
  const cron = typeof expression === "string" ? expression.trim() : "";
  if (CRON_MACROS.has(cron)) return null;
  const fields = cron.split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    return "Cron expression: use 5 fields, or 6 with seconds first.";
  }
  if (fields.length === 5) fields.unshift("0");

  const values: number[][] = [];
  for (const [index, { name, min, max }] of CRON_FIELDS.entries()) {
    const aliases = index === 4 ? MONTHS : index === 5 ? WEEKDAYS : [];
    let field = fields[index].replace(/[a-z]{3}/gi, (alias) => {
      const position = aliases.indexOf(alias.toLowerCase());
      return position < 0 ? alias : String(position + (index === 4 ? 1 : 0));
    });
    if (index === 5 && field.includes("#")) {
      // cron-parser does not combine # with lists, ranges, or steps.
      const nthDay = /^(\d+|\*|\?)#(\d+)$/.exec(field);
      if (!nthDay || Number(nthDay[2]) < 1 || Number(nthDay[2]) > 5) {
        return "Cron day of week: use a weekday followed by #1 through #5.";
      }
      field = nthDay[1];
    }
    if ((index === 3 || index === 5) && !field.includes("*")) field = field.replace(/\?/g, "*");
    const numbers = new Set<number>();
    for (const part of field.split(",")) {
      if (index === 3 && part === "L") continue;
      if (index === 5 && /^\d+L$/.test(part) && Number(part.slice(0, -1)) <= 7) continue;
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) return `Cron ${name}: use ${min}–${max}, *, ranges, lists, or steps.`;
      const step = match[2] === undefined ? 1 : Number(match[2]);
      const [from, to] = match[1] === "*"
        ? [min, max]
        : match[1].split("-").map(Number);
      const end = to ?? (match[2] === undefined ? from : max);
      if (!Number.isSafeInteger(step) || step < 1) return `Cron ${name}: step must be a positive integer.`;
      if (from < min || end > max || from > end) return `Cron ${name}: use values from ${min} to ${max} in ascending ranges.`;
      for (let value = from; value <= end; value += step) numbers.add(value);
    }
    values.push([...numbers]);
  }

  // cron-parser rejects an explicit month when none of its days can exist.
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (values[4].length === 1 && values[3].length > 0 &&
      values[3].every((day) => day > daysInMonth[values[4][0] - 1])) {
    return "Cron day of month: choose a day that exists in the selected month.";
  }
  return null;
}

export function validatePort(value: unknown, field = "Port"): string | null {
  const port = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? null
    : `${field}: enter a whole number from 1 to 65535.`;
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.includes("\0");
}

/** Validate supplied patch fields, including the source required by a new mount type. */
export function validateMount(input: {
  type?: "volume" | "bind" | "file";
  mountPath?: string;
  volumeName?: string;
  hostPath?: string;
}): string | null {
  if (!input || typeof input !== "object") return "Mount: enter a container path and source.";
  if (input.mountPath !== undefined && (!isAbsolutePath(input.mountPath) || /^\/+$/.test(input.mountPath))) {
    return "Mount path: enter an absolute container path other than /, without NUL characters.";
  }
  if ((input.type === "volume" || input.volumeName !== undefined) &&
      (typeof input.volumeName !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(input.volumeName) || /\s/.test(input.volumeName))) {
    return "Volume name: start with a letter or number; use only letters, numbers, _, . or -.";
  }
  if ((input.type === "bind" || input.hostPath !== undefined) && !isAbsolutePath(input.hostPath)) {
    return "Host path: enter an absolute path without NUL characters.";
  }
  return null;
}

// dotenv 16.4.5 permits multiline values in all three quote styles and expands
// escaped newlines only in double quotes. Match the closing quote before
// consuming continuation lines, so unmatched quotes retain dotenv's literal fallback.
// https://github.com/motdotla/dotenv/blob/v16.4.5/lib/main.js
const QUOTED_ENV_VALUE = /^\s*('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`)\s*(?:#[^\n]*)?(?:\n|$)/;

/** Parse dotenv assignments; report ignored bare lines. Duplicate keys count once. */
export function parseEnvironment(env: string): { variables: Map<string, string>; error: string | null } {
  const variables = new Map<string, string>();
  if (typeof env !== "string") return { variables, error: "Variables: enter KEY=value assignments." };
  const source = env.replace(/\r\n?/g, "\n");
  let error: string | null = null;
  let offset = 0;
  let lineNumber = 1;
  while (offset < source.length) {
    const start = offset;
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline;
    const raw = source.slice(start, end);
    const line = raw.trim();
    const currentLine = lineNumber++;
    offset = end + 1;
    if (!line || line.startsWith("#")) continue;
    const separator = raw.indexOf("=");
    if (separator < 0) {
      error ??= `Variables line ${currentLine}: use KEY=value.`;
      continue;
    }
    const key = raw.slice(0, separator).trim().replace(/^export\s+/, "");
    const validKey = key.length > 0 && !/\s|^[\d=]/.test(key);
    if (!validKey) {
      error ??= `Variables line ${currentLine}: key must be non-empty, without whitespace or a leading digit.`;
    }

    const valueStart = start + separator + 1;
    const quoted = QUOTED_ENV_VALUE.exec(source.slice(valueStart));
    let value: string;
    if (quoted) {
      value = quoted[1].slice(1, -1);
      if (quoted[1][0] === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
      offset = valueStart + quoted[0].length;
      lineNumber = currentLine + quoted[0].split("\n").length - 1;
    } else {
      value = raw.slice(separator + 1).split("#")[0].trim();
    }
    if (validKey) variables.set(key, value);
  }
  return { variables, error };
}
