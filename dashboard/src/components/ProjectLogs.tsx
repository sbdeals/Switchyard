"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Search } from "lucide-react";
import type { ProjectNode } from "@/lib/dokploy";
import {
  filterLogs,
  formatLogJson,
  LOG_LEVELS,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from "@/lib/log-explorer";
import { startLogPolling } from "@/lib/log-polling";
import { cn } from "@/lib/utils";

const controlCls = "rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50";
const rangeOptions = { "15m": "Last 15 minutes", "1h": "Last hour", "6h": "Last 6 hours" };
type TimeRange = keyof typeof rangeOptions;

interface Snapshot {
  sources: LogSource[];
  lines: LogEntry[];
  warnings: string[];
  fetchedAt: number;
}

export function ProjectLogs({ projects }: { projects: ProjectNode[] }) {
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const project = projects.find((p) => p.projectId === projectId) ?? projects[0];
  const environment = project?.environments.find((e) => e.environmentId === environmentId)
    ?? project?.environments[0];

  return (
    <section aria-label="Project log explorer" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Project logs</h2>
          <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
            Runtime logs across services, ordered by timestamp.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
            Project
            <select
              aria-label="Log project"
              className={controlCls}
              value={project?.projectId ?? ""}
              onChange={(e) => { setProjectId(e.target.value); setEnvironmentId(""); }}
            >
              {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
            Environment
            <select
              aria-label="Log environment"
              className={controlCls}
              value={environment?.environmentId ?? ""}
              onChange={(e) => setEnvironmentId(e.target.value)}
            >
              {project?.environments.map((e) => <option key={e.environmentId} value={e.environmentId}>{e.name}</option>)}
            </select>
          </label>
        </div>
      </div>
      {project && environment ? (
        <ScopedLogs key={`${project.projectId}:${environment.environmentId}`} projectId={project.projectId} environmentId={environment.environmentId} />
      ) : (
        <p className="py-12 text-center text-sm text-[var(--color-fg-muted)]">Create a project and environment to explore its logs.</p>
      )}
    </section>
  );
}

function ScopedLogs({ projectId, environmentId }: { projectId: string; environmentId: string }) {
  const [range, setRange] = useState<TimeRange>("15m");
  const [live, setLive] = useState(true);
  const liveRef = useRef(true);
  const poller = useRef<ReturnType<typeof startLogPolling<Snapshot>> | null>(null);
  const [snapshot, setSnapshot] = useState<{ range: TimeRange; data: Snapshot } | null>(null);
  const [failure, setFailure] = useState<{ range: TimeRange; message: string } | null>(null);
  const [selectedServices, setSelectedServices] = useState<string[] | undefined>();
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const data = snapshot?.range === range ? snapshot.data : null;
  const error = failure?.range === range ? failure.message : null;

  useEffect(() => {
    const query = new URLSearchParams({ projectId, environmentId, range });
    const current = startLogPolling<Snapshot>({
      live: liveRef.current,
      load: async (signal) => {
        const response = await fetch(`/api/projects/logs?${query}`, { signal, cache: "no-store" });
        if (!response.ok || response.redirected) {
          throw new Error(response.status === 401 || response.redirected
            ? "Your session expired. Sign in again to read logs."
            : "Could not load project logs. Try refreshing.");
        }
        return response.json() as Promise<Snapshot>;
      },
      onData: (result) => {
        setSnapshot({ range, data: result });
        setFailure(null);
      },
      onError: (error) => setFailure({ range, message: error instanceof Error ? error.message : "Could not load project logs. Try refreshing." }),
    });
    poller.current = current;
    return () => { current.close(); poller.current = null; };
  }, [projectId, environmentId, range]);

  useEffect(() => {
    if (stick.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [data]);

  const shown = filterLogs(data?.lines ?? [], {
    serviceIds: selectedServices,
    levels: level === "all" ? undefined : [level],
    search,
  });
  const sources = data?.sources ?? [];

  function toggleService(id: string, checked: boolean) {
    setSelectedServices((selected) => {
      const ids = selected ?? sources.map((source) => source.id);
      return checked ? [...ids, id] : ids.filter((value) => value !== id);
    });
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] p-3">
        <details className="relative">
          <summary className={cn(controlCls, "flex cursor-pointer list-none items-center gap-2")}>
            Services · {selectedServices === undefined ? "All" : selectedServices.length}
            <ChevronDown className="size-3.5" />
          </summary>
          <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-3 shadow-xl">
            <div className="mb-2 flex gap-3 text-xs text-[var(--color-brand)]">
              <button type="button" onClick={() => setSelectedServices(undefined)}>All services</button>
              <button type="button" onClick={() => setSelectedServices([])}>Clear</button>
            </div>
            <div className="max-h-56 space-y-2 overflow-auto">
              {sources.map((source) => (
                <label key={source.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedServices === undefined || selectedServices.includes(source.id)}
                    onChange={(e) => toggleService(source.id, e.target.checked)}
                    className="accent-[var(--color-brand)]"
                  />
                  <span className="break-all">{source.name}</span>
                </label>
              ))}
              {sources.length === 0 && <p className="text-xs text-[var(--color-fg-muted)]">No services found.</p>}
            </div>
          </div>
        </details>
        <select aria-label="Log level" value={level} onChange={(e) => setLevel(e.target.value as typeof level)} className={controlCls}>
          <option value="all">All levels</option>
          {LOG_LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
          <option value="unknown">unknown</option>
        </select>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <input aria-label="Search project logs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search log text…" className={cn(controlCls, "w-full pl-8")} />
        </div>
        <select aria-label="Log time range" value={range} onChange={(e) => setRange(e.target.value as TimeRange)} className={controlCls}>
          {Object.entries(rangeOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button
          type="button"
          aria-pressed={live}
          onClick={() => {
            liveRef.current = !live;
            setLive(!live);
            poller.current?.setLive(!live);
          }}
          className={cn(controlCls, "inline-flex items-center gap-2", live && "text-[var(--color-ok)]")}
        >
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", live ? "bg-[var(--color-ok)]" : "bg-[var(--color-idle)]")} />
          Live tail {live ? "on" : "off"}
        </button>
        <button type="button" aria-label="Refresh project logs" onClick={() => poller.current?.refresh()} className={controlCls}>
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap justify-between gap-2 px-4 py-2 text-[11px] text-[var(--color-fg-muted)]" role="status">
        <span>{shown.length} of {data?.lines.length ?? 0} recent lines</span>
        <span>{error ? "Updates unavailable" : !live ? "Paused" : !data ? "Loading…" : "Live · refreshes every 3s"}{data && ` · Updated ${new Date(data.fetchedAt).toLocaleTimeString()}`}</span>
      </div>
      {error && <p role="alert" className="px-4 pb-2 text-xs text-[var(--color-danger)]">{error}{data && " Showing the last successful snapshot."}</p>}
      {data?.warnings.map((warning) => <p key={warning} className="px-4 pb-2 text-xs text-[var(--color-warn)]">{warning}</p>)}

      <div className="grid grid-cols-[6rem_12rem_4rem_1fr] gap-3 border-y border-[var(--color-border)] px-4 py-2 text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)] max-sm:hidden">
        <span>Time</span><span>Service</span><span>Level</span><span>Message</span>
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        role="log"
        aria-label="Project runtime logs"
        aria-live="off"
        onScroll={(e) => {
          const element = e.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
        className="h-[min(60vh,640px)] min-h-64 overflow-auto bg-[var(--color-code-bg)] px-4 py-2 font-mono text-[11px] leading-relaxed"
      >
        {shown.length > 0 ? shown.map((line) => <LogRow key={line.id} line={line} />) : (
          <div className="flex h-full items-center justify-center gap-2 text-[var(--color-fg-muted)]">
            {!data && !error && !live ? "Live tail is paused. Refresh to load a snapshot."
              : !data && !error ? <><Loader2 className="size-4 animate-spin" /> Loading logs…</>
              : error && !data ? "Logs are unavailable. Use Refresh to retry."
              : data?.lines.length ? "No logs match these filters."
              : "No retained logs in this time range."}
          </div>
        )}
      </div>
      <p className="border-t border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-fg-subtle)]">
        Only what Docker keeps. Up to 300 recent lines per container, 2,000 total, from 32 containers on this host. Long lines are truncated. Busy services can fill this window between refreshes.
      </p>
    </div>
  );
}

function LogRow({ line }: { line: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const levelColor = line.level === "error" ? "text-[var(--color-danger)]"
    : line.level === "warn" ? "text-[var(--color-warn)]"
    : line.level === "debug" ? "text-[var(--color-fg-subtle)]"
    : "text-[var(--color-fg-muted)]";
  return (
    <div className="grid grid-cols-[6rem_12rem_4rem_1fr] items-start gap-3 border-b border-white/[0.03] py-1.5 max-sm:grid-cols-[5rem_1fr]">
      <time title={line.ts === null ? "Unknown timestamp" : new Date(line.ts).toISOString()} className="text-[var(--color-fg-subtle)]">
        {line.ts === null ? "—" : new Date(line.ts).toLocaleTimeString()}
      </time>
      <span title={line.serviceName} className="truncate text-[var(--color-brand)]">{line.serviceName}</span>
      <span className={levelColor}>{line.level}</span>
      <div className="min-w-0 text-[var(--color-fg-muted)]">
        {line.json !== undefined ? (
          <details onToggle={(e) => setExpanded(e.currentTarget.open)}>
            <summary className="cursor-pointer break-all whitespace-pre-wrap">{line.text}</summary>
            {expanded && <pre className="mt-2 overflow-auto rounded-md bg-[var(--color-surface)] p-3 whitespace-pre-wrap break-all">{formatLogJson(line.json)}</pre>}
          </details>
        ) : <span className="whitespace-pre-wrap break-all">{line.text}</span>}
        {line.truncated && <span className="ml-2 text-[var(--color-warn)]">[line truncated]</span>}
      </div>
    </div>
  );
}
