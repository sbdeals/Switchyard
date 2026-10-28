"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Loader2, Search } from "lucide-react";
import { DEFAULT_LOG_LINE_LIMIT, LOG_LINE_OPTIONS } from "@/lib/log-export";
import { copyVisibleLogs, downloadServiceLogs } from "@/lib/log-export-client";
import { Btn } from "./primitives";
import { AnsiText } from "@/components/service/AnsiText";
import { parseAnsi, type ParsedAnsi } from "@/lib/ansi";
import { logConnectionError } from "@/lib/api-client";

interface Line extends ParsedAnsi {
  id: number;
  ts: number;
  stored?: boolean;
}

const LogLine = memo(function LogLine({ line }: { line: Line }) {
  return (
    <div className={`flex gap-3 whitespace-pre-wrap break-all ${line.stored ? "opacity-70" : ""}`}>
      <span className="shrink-0 select-none text-[var(--color-fg-subtle)]">
        {new Date(line.ts).toLocaleTimeString()}
      </span>
      <span className="min-w-0 text-[var(--color-fg-muted)]"><AnsiText value={line} /></span>
    </div>
  );
});

export function LogsTab({ appName, active }: { appName: string; active: boolean }) {
  // Lines carry a monotonic id assigned on arrival: the buffer is trimmed from
  // the front, so array indexes are not stable React keys.
  const [lines, setLines] = useState<Line[]>([]);
  const nextId = useRef(0);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState("");
  const [lineLimit, setLineLimit] = useState(DEFAULT_LOG_LINE_LIMIT);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!active || !appName) return;
    const url = `/api/services/logs?app=${encodeURIComponent(appName)}`;
    const es = new EventSource(url);
    let probe: AbortController | undefined;
    es.onopen = () => { probe?.abort(); setConnected(true); setError(null); };
    es.addEventListener("reset", () => setLines([]));
    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data) as { ts: number; text: string; stored?: boolean };
        const line: Line = { ...parseAnsi(raw.text), ts: raw.ts, id: nextId.current++, ...(raw.stored ? { stored: true } : {}) };
        setLines((prev) => {
          const next = prev.length > 2000 ? prev.slice(-1500) : prev;
          return [...next, line];
        });
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      setConnected(false);
      probe?.abort();
      const controller = new AbortController();
      probe = controller;
      void logConnectionError(url, controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Logs unavailable.");
      });
    };
    return () => { probe?.abort(); es.close(); };
  }, [appName, active]);

  useEffect(() => {
    if (stick.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const shown = useMemo(() => {
    const query = filter.toLowerCase();
    return query ? lines.filter((l) => l.text.toLowerCase().includes(query)) : lines;
  }, [lines, filter]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function copy() {
    setError(null);
    setNotice(null);
    try {
      await copyVisibleLogs(shown);
      setNotice(`Copied ${shown.length} visible log lines`);
    } catch {
      setError("Could not copy logs. Check your browser's clipboard permission.");
    }
  }

  async function download(format: "log" | "json") {
    setError(null);
    setDownloading(true);
    try {
      await downloadServiceLogs(appName, lineLimit, format);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download logs.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter logs…"
            aria-label="Filter logs"
            className="w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] py-1.5 pl-8 pr-3 text-xs outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
          />
        </div>
        <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${connected ? "bg-[var(--color-ok)]" : "bg-[var(--color-idle)]"}`}
          />
          {connected ? "Live" : "Disconnected"}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Btn onClick={copy} disabled={shown.length === 0}>
          <Copy className="size-3.5" /> Copy visible
        </Btn>
        <select
          aria-label="Download line limit"
          value={lineLimit}
          onChange={(e) => setLineLimit(Number(e.target.value))}
          className="rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
        >
          {LOG_LINE_OPTIONS.map((limit) => (
            <option key={limit} value={limit}>Last {limit / 1000}k lines</option>
          ))}
        </select>
        <Btn onClick={() => download("log")} disabled={downloading}>
          <Download className="size-3.5" /> Download .log
        </Btn>
        <Btn onClick={() => download("json")} disabled={downloading}>
          <Download className="size-3.5" /> Download .json
        </Btn>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">Downloads include unfiltered logs.</span>
      </div>
      {notice && (
        <div role="status" className="mb-3 rounded-lg border border-[var(--color-ok)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ok)]">
          {notice}
        </div>
      )}
      {error && <p role="alert" className="mb-3 text-xs text-[var(--color-danger)]">{error}</p>}

      <div
        ref={scrollRef}
        tabIndex={0}
        role="log"
        aria-label="Service logs"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-code-bg)] p-3 font-mono text-[11px] leading-relaxed"
      >
        {shown.some((l) => l.stored) && (
          <div className="mb-2 border-b border-[var(--color-border)] pb-2 text-[var(--color-fg-subtle)]">
            from history
          </div>
        )}
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[var(--color-fg-subtle)]">
            <Loader2 className="size-4 animate-spin" /> waiting for logs…
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[var(--color-fg-subtle)]">
            <p className="max-w-full break-all">No logs match &quot;{filter}&quot;</p>
            <button
              type="button"
              onClick={() => setFilter("")}
              className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              Clear filter
            </button>
          </div>
        ) : (
          shown.map((l) => <LogLine key={l.id} line={l} />)
        )}
      </div>
    </div>
  );
}
