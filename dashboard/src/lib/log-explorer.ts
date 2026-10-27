export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number] | "unknown";

export const MAX_LOG_LINES = 2000;
export const MAX_LOG_LINE_LENGTH = 8192;

export interface LogSource {
  id: string;
  name: string;
  appName: string;
}

export interface LogBatch {
  source: LogSource;
  lines: string[];
}

export interface LogEntry {
  id: string;
  sourceId: string;
  serviceName: string;
  ts: number | null;
  /** Docker timestamp precision beyond the whole milliseconds in ts. */
  subMillisecondNanos?: number;
  text: string;
  level: LogLevel;
  json?: unknown;
  truncated: boolean;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2}))\s+/;
const DATE_PREFIX = /^\[?(?:\d{4}-\d{2}-\d{2}[T ])?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?\]?\s*/;

function levelFrom(value: unknown): LogLevel {
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    switch (Number(value)) {
      case 10:
      case 20: return "debug";
      case 30: return "info";
      case 40: return "warn";
      case 50:
      case 60: return "error";
      default: return "unknown";
    }
  }
  if (typeof value !== "string") return "unknown";
  switch (value.toLowerCase().trim()) {
    case "fatal":
    case "panic":
    case "critical":
    case "err":
    case "error": return "error";
    case "warning":
    case "warn": return "warn";
    case "notice":
    case "info": return "info";
    case "trace":
    case "debug": return "debug";
    default: return "unknown";
  }
}

function timestampFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Most JSON loggers use epoch milliseconds; some use epoch seconds.
    const ts = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
    return Number.isFinite(new Date(ts).getTime()) ? ts : null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function hash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  }
  return (value >>> 0).toString(36);
}

export function parseLogLine(line: string, source: LogSource, index = 0): LogEntry {
  // Bound work and JSON allocations even when a container emits one huge line.
  const raw = line.slice(0, MAX_LOG_LINE_LENGTH + 64);
  let text = raw.replace(ANSI, "").replace(/\r$/, "");
  const timestamp = text.match(TIMESTAMP);
  let ts = timestamp ? timestampFrom(timestamp[1]) : null;
  const subMillisecondNanos = ts === null ? 0 : Number((timestamp?.[2] ?? "").padEnd(9, "0").slice(3, 9));
  if (timestamp && ts !== null) text = text.slice(timestamp[0].length);
  const truncated = line.length > raw.length || text.length > MAX_LOG_LINE_LENGTH;
  text = text.slice(0, MAX_LOG_LINE_LENGTH);

  let json: unknown;
  let level: LogLevel = "unknown";
  if (!truncated && /^[\s]*[\[{]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object") {
        json = parsed;
        if (!Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>;
          level = levelFrom(record.level);
          ts ??= timestampFrom(record.timestamp) ?? timestampFrom(record.time) ?? timestampFrom(record.ts);
        }
      }
    } catch {
      // Partial or malformed JSON is still useful as a plain log line.
    }
  }
  if (level === "unknown") {
    const prefix = text.trimStart().replace(DATE_PREFIX, "").match(/^[\[(]?(fatal|panic|critical|error|err|warning|warn|notice|info|trace|debug)(?=$|[\s\]):\-])/i);
    if (prefix) level = levelFrom(prefix[1]);
  }

  return {
    id: `${source.id}:${hash(`${timestamp?.[1] ?? ts ?? ""}\n${text}`)}:${index}`,
    sourceId: source.id,
    serviceName: source.name,
    ts,
    ...(subMillisecondNanos === 0 ? {} : { subMillisecondNanos }),
    text,
    level,
    ...(json === undefined ? {} : { json }),
    truncated,
  };
}

/** Merge a bounded recent snapshot. Undated lines sort first and remain visible. */
export function mergeLogs(batches: LogBatch[], options: { since: number; limit?: number }): LogEntry[] {
  const requested = options.limit ?? MAX_LOG_LINES;
  const limit = Number.isFinite(requested) ? Math.max(0, Math.min(MAX_LOG_LINES, Math.floor(requested))) : MAX_LOG_LINES;
  if (limit === 0) return [];
  const entries: LogEntry[] = [];
  for (const batch of batches) {
    for (const line of batch.lines) {
      const entry = parseLogLine(line, batch.source);
      if (entry.ts !== null && entry.ts < options.since) continue;
      // Insert after equal timestamps to preserve source order, retaining only
      // the newest entries throughout processing rather than collecting all logs.
      const time = entry.ts ?? -Infinity;
      let low = 0;
      let high = entries.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const other = entries[middle];
        const otherTime = other.ts ?? -Infinity;
        if (otherTime < time || (otherTime === time && (other.subMillisecondNanos ?? 0) <= (entry.subMillisecondNanos ?? 0))) low = middle + 1;
        else high = middle;
      }
      if (entries.length === limit && low === 0) continue;
      entries.splice(low, 0, entry);
      if (entries.length > limit) entries.shift();
    }
  }

  // Identical lines are separate events. Occurrence counts are bounded by the
  // retained snapshot and ordinary IDs survive a changing Docker tail window.
  const occurrences = new Map<string, number>();
  return entries.map((entry) => {
    const occurrence = occurrences.get(entry.id) ?? 0;
    occurrences.set(entry.id, occurrence + 1);
    return { ...entry, id: `${entry.id}:${occurrence}` };
  });
}

export function filterLogs(
  entries: LogEntry[],
  filters: { serviceIds?: string[]; levels?: LogLevel[]; search?: string; since?: number },
): LogEntry[] {
  const services = filters.serviceIds === undefined ? null : new Set(filters.serviceIds);
  const levels = filters.levels === undefined ? null : new Set(filters.levels);
  const search = filters.search?.trim().toLowerCase();
  return entries.filter((entry) =>
    (!services || services.has(entry.sourceId)) &&
    (!levels || levels.has(entry.level)) &&
    (!search || entry.text.toLowerCase().includes(search)) &&
    (filters.since === undefined || entry.ts === null || entry.ts >= filters.since)
  );
}

/** Pretty-print only when expanded, limiting indentation growth in nested JSON. */
export function formatLogJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  function bounded(item: unknown, depth: number): unknown {
    if (item === null || typeof item !== "object") return item;
    if (depth >= 12) return "… maximum JSON depth reached";
    if (ancestors.has(item)) return "… circular reference";
    ancestors.add(item);
    const result = Array.isArray(item)
      ? item.map((child) => bounded(child, depth + 1))
      : Object.fromEntries(Object.entries(item).map(([key, child]) => [key, bounded(child, depth + 1)]));
    ancestors.delete(item);
    return result;
  }

  const formatted = JSON.stringify(bounded(value, 0), null, 2) ?? "";
  const limit = 32_768;
  const marker = "\n… formatted JSON truncated";
  return formatted.length > limit ? formatted.slice(0, limit - marker.length) + marker : formatted;
}
