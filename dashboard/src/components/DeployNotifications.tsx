"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCircle2, CircleSlash, TriangleAlert, X } from "lucide-react";
import type { Service } from "@/lib/dokploy";
import {
  deploymentStatusLabel, detectDeploymentEvents, eventsForProject,
  formatDeploymentDuration, markAllRead, mergeActivity, parseStoredActivity, visibleActivity,
  type DeploymentEvent, type DeploymentTracker,
} from "@/lib/deploy-notifications";

export function DeployNotifications({ services, projectId, storageKey, onViewLogs }: {
  services: Service[];
  projectId: string | null;
  storageKey: string;
  onViewLogs: (event: DeploymentEvent) => void;
}) {
  const [activity, setActivity] = useState<DeploymentEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<DeploymentEvent[]>([]);
  const [toastProject, setToastProject] = useState(projectId);
  const [open, setOpen] = useState(false);
  const tracker = useRef<DeploymentTracker | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);

  // A dismissed project scope must not resurrect its old toast timers later.
  if (toastProject !== projectId) {
    setToastProject(projectId);
    setToasts([]);
  }

  useEffect(() => {
    let stored: DeploymentEvent[] = [];
    try { stored = parseStoredActivity(localStorage.getItem(storageKey)); } catch { /* memory fallback */ }
    // Synchronize the browser's persisted activity after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivity(stored);
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(storageKey, JSON.stringify(activity)); } catch { /* memory fallback */ }
  }, [activity, loaded, storageKey]);

  useEffect(() => {
    const next = detectDeploymentEvents(tracker.current, services, Date.now());
    tracker.current = next.tracker;
    if (!next.events.length) return;
    // Deployment transitions arrive through refreshed server props.
    setActivity((previous) => mergeActivity(previous, next.events));
    setToasts((previous) => [...previous, ...eventsForProject(next.events, projectId)].slice(-20));
  }, [services, projectId]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); bell.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const recent = eventsForProject(visibleActivity(activity, services), projectId);
  const unread = recent.filter((event) => !event.read).length;
  const dismiss = (id: string) => setToasts((previous) => previous.filter((event) => event.id !== id));
  const viewLogs = (event: DeploymentEvent) => {
    setActivity((previous) => previous.map((item) => item.id === event.id ? { ...item, read: true } : item));
    dismiss(event.id);
    setOpen(false);
    onViewLogs(event);
  };

  return (
    <div className="relative" ref={panel}>
      <button
        ref={bell}
        type="button"
        aria-label={`Deploy activity${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        aria-controls="deploy-activity"
        onClick={() => setOpen(!open)}
        className="relative rounded-lg border border-[var(--color-border-strong)] p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
      >
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-[var(--color-brand)] px-1 text-center text-[10px] font-semibold text-white">{unread}</span>}
      </button>
      {open && (
        <section id="deploy-activity" aria-label="Recent deploy activity" className="absolute right-0 top-11 z-[60] w-96 max-w-[85vw] overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Recent deploy activity</h2>
            <button type="button" disabled={!unread} onClick={() => {
              const ids = new Set(recent.map((event) => event.id));
              setActivity((previous) => previous.map((event) => ids.has(event.id) ? markAllRead([event])[0] : event));
            }} className="flex items-center gap-1 text-xs text-[var(--color-brand)] disabled:opacity-40">
              <Check className="size-3.5" /> Mark all read
            </button>
          </div>
          <p className="px-4 pt-3 text-[11px] text-[var(--color-fg-subtle)]">Last 20 deploy events in this browser.</p>
          <ul className="max-h-96 overflow-y-auto p-2">
            {recent.map((event) => (
              <li key={event.id} className="flex gap-2.5 rounded-lg p-2.5 hover:bg-[var(--color-surface)]">
                <EventIcon event={event} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs font-medium"><span className="truncate">{event.serviceName}</span>{!event.read && <span aria-label="Unread" className="size-1.5 shrink-0 rounded-full bg-[var(--color-brand)]" />}</div>
                  <EventSummary event={event} />
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                    <time dateTime={event.finishedAt} className="text-[var(--color-fg-subtle)]">{new Date(event.finishedAt).toLocaleString()}</time>
                    <button type="button" onClick={() => viewLogs(event)} className="shrink-0 text-[var(--color-brand)] hover:underline">View logs</button>
                  </div>
                </div>
              </li>
            ))}
            {recent.length === 0 && <li className="px-2 py-6 text-center text-xs text-[var(--color-fg-muted)]">No new deployments yet.</li>}
          </ul>
        </section>
      )}
      <div aria-live="polite" aria-relevant="additions" className="fixed bottom-5 right-5 z-[70] flex max-h-[70vh] w-96 max-w-[90vw] flex-col gap-2 overflow-y-auto">
        {eventsForProject(visibleActivity(toasts, services), projectId).map((event) => (
          <DeployToast key={event.id} event={event} onDismiss={dismiss} onViewLogs={viewLogs} />
        ))}
      </div>
    </div>
  );
}

function EventIcon({ event }: { event: DeploymentEvent }) {
  return event.status === "done" ? <CheckCircle2 className="size-4 shrink-0 text-[var(--color-ok)]" />
    : event.status === "error" ? <TriangleAlert className="size-4 shrink-0 text-[var(--color-danger)]" />
      : <CircleSlash className="size-4 shrink-0 text-[var(--color-fg-muted)]" />;
}

function EventSummary({ event }: { event: DeploymentEvent }) {
  return <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{deploymentStatusLabel(event.status)} · {formatDeploymentDuration(event.durationMs)}</p>;
}

function DeployToast({ event, onDismiss, onViewLogs }: {
  event: DeploymentEvent;
  onDismiss: (id: string) => void;
  onViewLogs: (event: DeploymentEvent) => void;
}) {
  const [paused, setPaused] = useState(false);
  // Keep callback changes during polling from extending the timeout.
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismiss.current(event.id), 15_000);
    return () => clearTimeout(timer);
  }, [event.id, paused]);
  return (
    <div role="status" aria-label={`${event.serviceName} ${deploymentStatusLabel(event.status)}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }} className="flex items-start gap-3 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-4 shadow-2xl">
      <EventIcon event={event} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{event.serviceName}</p>
        <EventSummary event={event} />
        <button type="button" onClick={() => onViewLogs(event)} className="mt-2 text-xs font-medium text-[var(--color-brand)] hover:underline">View logs</button>
      </div>
      <button type="button" aria-label={`Dismiss ${event.serviceName} notification`} onClick={() => onDismiss(event.id)} className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"><X className="size-4" /></button>
    </div>
  );
}
