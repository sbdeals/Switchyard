"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { AnsiText } from "@/components/service/AnsiText";
import { parseAnsi, type ParsedAnsi } from "@/lib/ansi";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!active || !appName) return;
    const es = new EventSource(`/api/services/logs?app=${encodeURIComponent(appName)}`);
    es.onopen = () => setConnected(true);
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
    es.onerror = () => setConnected(false);
    return () => es.close();
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

      <div
        ref={scrollRef}
        tabIndex={0}
        role="log"
        aria-label="Service logs"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 overflow-auto rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-3 font-mono text-[11px] leading-relaxed"
      >
        {shown.some((l) => l.stored) && (
          <div className="mb-2 border-b border-[var(--color-border)] pb-2 text-[var(--color-fg-subtle)]">
            from history
          </div>
        )}
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[var(--color-fg-subtle)]">
            <Loader2 className="size-4 animate-spin" /> waiting for logs…
          </div>
        ) : (
          shown.map((l) => <LogLine key={l.id} line={l} />)
        )}
      </div>
    </div>
  );
}
