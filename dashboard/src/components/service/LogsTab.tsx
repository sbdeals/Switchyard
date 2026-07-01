"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";

interface Line {
  ts: number;
  text: string;
}

export function LogsTab({ appName, active }: { appName: string; active: boolean }) {
  // Lines carry a monotonic id assigned on arrival: the buffer is trimmed from
  // the front, so array indexes are not stable React keys.
  const [lines, setLines] = useState<(Line & { id: number })[]>([]);
  const nextId = useRef(0);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!active || !appName) return;
    const es = new EventSource(`/api/services/logs?app=${encodeURIComponent(appName)}`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data) as Line;
        setLines((prev) => {
          const next = prev.length > 2000 ? prev.slice(-1500) : prev;
          return [...next, { ...line, id: nextId.current++ }];
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

  const shown = filter
    ? lines.filter((l) => l.text.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter logs…"
            className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-1.5 pl-8 pr-3 text-xs outline-none focus:border-[var(--color-brand)]"
          />
        </div>
        <span className="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
          <span
            className={`size-1.5 rounded-full ${connected ? "bg-[var(--color-ok)]" : "bg-[var(--color-idle)]"}`}
          />
          {connected ? "Live" : "…"}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 overflow-auto rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-3 font-mono text-[11px] leading-relaxed"
      >
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[var(--color-fg-subtle)]">
            <Loader2 className="size-4 animate-spin" /> waiting for logs…
          </div>
        ) : (
          shown.map((l) => (
            <div key={l.id} className="flex gap-3 whitespace-pre-wrap break-all">
              <span className="shrink-0 select-none text-[var(--color-fg-subtle)]">
                {new Date(l.ts).toLocaleTimeString()}
              </span>
              <span className="text-[var(--color-fg-muted)]">{l.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
