"use client";

import { useEffect, useId, useState } from "react";
import { Activity, ArrowUpRight, Clock, Loader2, X } from "lucide-react";
import type { ProjectNode } from "@/lib/dokploy";
import {
  filterActivity,
  formatActivityDuration,
  formatActivityTime,
  type ActivityEntry,
  type ActivityStatus,
} from "@/lib/activity";
import { watchActivity } from "@/lib/activity-feed";
import { useDialogFocus } from "@/components/use-focus-trap";

const STATUS_COLORS: Record<ActivityStatus, string> = {
  queued: "var(--color-idle)",
  running: "var(--color-warn)",
  done: "var(--color-ok)",
  error: "var(--color-danger)",
  cancelled: "var(--color-fg-subtle)",
};

/** Mounted only while open, so closing always stops requests and timers. */
export function ActivityPanel({
  projects,
  onClose,
  onSelect,
}: {
  projects: ProjectNode[];
  onClose: () => void;
  onSelect: (entry: ActivityEntry) => void;
}) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<ActivityStatus | "all">("all");
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLElement>(onClose);

  useEffect(() => watchActivity((next) => {
    setEntries(next);
    setError(null);
  }, setError), []);

  const visible = filterActivity(entries ?? [], { projectId, status });
  // Include projects discovered by a refresh since the workspace was loaded.
  const projectNames = new Map(projects.map((p) => [p.projectId, p.name]));
  for (const entry of entries ?? []) projectNames.set(entry.projectId, entry.projectName);

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl"
      >
        <header className="border-b border-[var(--color-border)] px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
              <Activity className="size-4 text-[var(--color-brand)]" /> Activity
            </h2>
            <button
              onClick={onClose}
              aria-label="Close activity"
              className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-fg-muted)]">
            Recent deployments across your services. Refreshes every 10 seconds while open.
          </p>
          <div className="mt-4 flex gap-3">
            <div className="min-w-0 flex-1 text-xs text-[var(--color-fg-muted)]">
              <label htmlFor={`${titleId}-project`}>Project</label>
              <select
                id={`${titleId}-project`}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-fg)]"
              >
                <option value="">All projects</option>
                {Array.from(projectNames, ([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            <div className="text-xs text-[var(--color-fg-muted)]">
              <label htmlFor={`${titleId}-status`}>Status</label>
              <select
                id={`${titleId}-status`}
                value={status}
                onChange={(e) => setStatus(e.target.value as ActivityStatus | "all")}
                className="mt-1 block w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-fg)]"
              >
                <option value="all">All statuses</option>
                <option value="queued">Queued</option>
                <option value="running">Running</option>
                <option value="done">Done</option>
                <option value="error">Error</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </header>

        {error && <p role="alert" className="border-b border-[var(--color-border)] px-6 py-3 text-xs text-[var(--color-danger)]">{error}</p>}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {entries === null && !error ? (
            <p role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-fg-muted)]">
              <Loader2 className="size-4 animate-spin" /> Loading activity…
            </p>
          ) : entries !== null && visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-[var(--color-fg-muted)]">
              {entries.length === 0 ? "No deployments yet." : "No deployments match these filters."}
            </p>
          ) : (
            <ul className="space-y-2" aria-label="Recent deployments">
              {visible.map((entry) => (
                <li key={`${entry.serviceId}:${entry.deploymentId}`}>
                  <button
                    onClick={() => onSelect(entry)}
                    className="group flex w-full gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]"
                  >
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLORS[entry.status] }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">{entry.serviceName}</span>
                        <span className="shrink-0 text-xs capitalize" style={{ color: STATUS_COLORS[entry.status] }}>{entry.status}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--color-fg-muted)]">{entry.projectName} / {entry.environmentName}</p>
                      <p className="mt-2 truncate text-sm" title={entry.title}>{entry.title}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--color-fg-subtle)]">
                        <time dateTime={entry.startedAt ?? undefined} title={entry.startedAt ? new Date(entry.startedAt).toLocaleString() : "Start time unavailable"}>
                          {formatActivityTime(entry.startedAt)}
                        </time>
                        <span className="inline-flex items-center gap-1" title="Deployment duration">
                          <Clock className="size-3" /> {formatActivityDuration(entry)}
                        </span>
                        <span className="ml-auto inline-flex items-center gap-1 group-hover:text-[var(--color-fg)]">
                          View deploys <ArrowUpRight className="size-3" />
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {entries !== null && (
          <p className="border-t border-[var(--color-border)] px-6 py-3 text-xs text-[var(--color-fg-subtle)]">
            {visible.length} {visible.length === 1 ? "deployment" : "deployments"} · Newest first
          </p>
        )}
      </aside>
    </div>
  );
}
