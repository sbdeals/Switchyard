export const LOG_LINE_OPTIONS = [1000, 5000, 10000] as const;
export const DEFAULT_LOG_LINE_LIMIT = 5000;
export const MAX_LOG_LINE_LIMIT = 10000;

export type LogFormat = "log" | "json";
export type LogStream = "stdout" | "stderr" | "unknown";
export interface ExportLogLine {
  ts: number;
  text: string;
  stream?: LogStream;
}

export function capLogLines(value?: string | number | null): number {
  if (value == null || value === "") return DEFAULT_LOG_LINE_LIMIT;
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return DEFAULT_LOG_LINE_LIMIT;
  return Math.min(MAX_LOG_LINE_LIMIT, Math.max(1, Math.floor(count)));
}

export function logDownloadFilename(service: string, format: LogFormat, now = new Date()): string {
  const name = service.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 80) || "service";
  return `${name}-${now.toISOString().replace(/[:.]/g, "-")}.${format}`;
}

/** Strip CSI styling/cursor codes, OSC links/titles, and other ANSI escapes. */
export function stripAnsi(text: string): string {
  return text.replace(/(?:\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x9d[\s\S]*?(?:\x07|\x9c)|(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~])/g, "");
}

export function formatVisibleLogs(lines: readonly ExportLogLine[]): string {
  return lines.map((line) => `${new Date(line.ts).toISOString()} ${stripAnsi(line.text)}`).join("\n");
}

/** Encode one record at a time so the response does not build a second full log string. */
export function logDownloadStream(lines: readonly ExportLogLine[], format: LogFormat): ReadableStream<Uint8Array> {
  function* chunks() {
    if (format === "json") yield "[";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (format === "json") {
        yield `${i ? "," : ""}\n${JSON.stringify({
          timestamp: new Date(line.ts).toISOString(),
          stream: line.stream ?? "unknown",
          text: line.text,
        })}`;
      } else {
        yield `${formatVisibleLogs([line])}\n`;
      }
    }
    if (format === "json") yield `${lines.length ? "\n" : ""}]\n`;
  }
  const iterator = chunks();
  const encoder = new TextEncoder();
  return new ReadableStream({
    pull(controller) {
      const next = iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    cancel() {
      iterator.return();
    },
  });
}

/** Docker frames retain stdout/stderr; a raw TTY stream cannot distinguish them. */
export function parseDockerLogLines(bytes: Uint8Array, now = Date.now()): ExportLogLine[] {
  const records: { order: number; text: string; stream: LogStream }[] = [];
  const streams = new Map<LogStream, { decoder: TextDecoder; pending: string; order: number }>();
  let order = 0;
  const append = (stream: LogStream, chunk: Uint8Array) => {
    let state = streams.get(stream);
    if (!state) {
      state = { decoder: new TextDecoder(), pending: "", order: order++ };
      streams.set(stream, state);
    } else if (!state.pending) {
      state.order = order++;
    }
    state.pending += state.decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = state.pending.indexOf("\n")) !== -1) {
      records.push({ order: state.order, text: state.pending.slice(0, newline), stream });
      state.pending = state.pending.slice(newline + 1);
      state.order = order++;
    }
  };

  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const type = bytes[offset];
    if (type > 2 || bytes[offset + 1] !== 0 || bytes[offset + 2] !== 0 || bytes[offset + 3] !== 0) break;
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0);
    const start = offset + 8;
    append(type === 1 ? "stdout" : type === 2 ? "stderr" : "unknown", bytes.subarray(start, start + length));
    offset = start + length;
  }
  if (offset === 0) append("unknown", bytes);
  for (const [stream, state] of streams) {
    const text = state.pending + state.decoder.decode();
    if (text) records.push({ order: state.order, text, stream });
  }
  return records.sort((a, b) => a.order - b.order).filter((line) => line.text.trim().length > 0).map(({ text, stream }) => {
    const match = text.match(/^(\S+)\s([\s\S]*)$/);
    const parsed = match ? Date.parse(match[1]) : NaN;
    return {
      ts: Number.isNaN(parsed) ? now : parsed,
      text: match && !Number.isNaN(parsed) ? match[2] : text,
      stream,
    };
  });
}
