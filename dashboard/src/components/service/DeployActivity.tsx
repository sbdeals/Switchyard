"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, ChevronRight, Loader2, RotateCcw, ScrollText } from "lucide-react";
import type { AppDeployment, Application, ComposeService } from "@/lib/dokploy";
import { rollbackDeploymentAction } from "@/app/actions";
import { explainDeployError, failureLine } from "@/lib/deploy-errors";
import { cn } from "@/lib/utils";

/** Services with deploy history (databases have none). */
type Deployable = Application | ComposeService;

/** Deploy-record status → display. "running" is Dokploy's in-flight state. */
const DEPLOY_STATUS: Record<string, { label: string; color: string; soft: string }> = {
  running: { label: "Deploying", color: "var(--color-warn)", soft: "var(--color-warn-soft)" },
  done: { label: "Succeeded", color: "var(--color-ok)", soft: "var(--color-ok-soft)" },
  error: { label: "Failed", color: "var(--color-danger)", soft: "var(--color-danger-soft)" },
  cancelled: { label: "Cancelled", color: "var(--color-idle)", soft: "var(--color-idle-soft)" },
};
const statusMeta = (s: string) =>
  DEPLOY_STATUS[s] ?? { label: s, color: "var(--color-idle)", soft: "var(--color-idle-soft)" };

/** Newest first. */
export function sortedDeployments(list: AppDeployment[]): AppDeployment[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** "42s", "3m 05s", "1h 02m". */
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Ticks every second while `live` — for elapsed-time readouts. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return now;
}

function StatusPill({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: meta.soft, color: meta.color }}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", status === "running" && "animate-pulse")}
        style={{ backgroundColor: meta.color }}
      />
      {meta.label}
    </span>
  );
}

// --- live log -----------------------------------------------------------------

interface DeployEnd {
  status: string;
  errorMessage: string | null;
}

/**
 * One deployment's build + deploy log, streamed from /api/services/deploy-logs
 * while the deploy runs and replayed in full once it has finished. When the
 * deploy fails, the most specific failure line (plus a plain-English cause for
 * known signatures) is pinned above the log.
 */
export function DeployLogs({
  service,
  deployment,
}: {
  service: Deployable;
  deployment: AppDeployment;
}) {
  const [lines, setLines] = useState<{ id: number; text: string }[]>([]);
  const nextId = useRef(0);
  const [status, setStatus] = useState(deployment.status);
  const [errorMessage, setErrorMessage] = useState(deployment.errorMessage);
  const [notices, setNotices] = useState<string[]>([]);
  const [phase, setPhase] = useState<"connecting" | "live" | "reconnecting" | "ended">("connecting");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const url =
      `/api/services/deploy-logs?kind=${service.kind}` +
      `&id=${encodeURIComponent(service.id)}` +
      `&deployment=${encodeURIComponent(deployment.deploymentId)}`;
    const es = new EventSource(url);
    let ended = false;
    es.onopen = () => {
      // The server replays the whole log on every connection.
      setLines([]);
      setNotices([]);
      setPhase("live");
    };
    es.onmessage = (e) => {
      try {
        const { text } = JSON.parse(e.data) as { text: string };
        setLines((prev) => {
          const next = prev.length > 5000 ? prev.slice(-4000) : prev;
          return [...next, { id: nextId.current++, text }];
        });
      } catch {
        /* ignore malformed */
      }
    };
    const onStatus = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as DeployEnd;
        setStatus(d.status);
        setErrorMessage(d.errorMessage);
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("status", onStatus);
    es.addEventListener("notice", (e) => {
      try {
        const { message } = JSON.parse((e as MessageEvent).data) as { message: string };
        setNotices((prev) => (prev.includes(message) ? prev : [...prev, message]));
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("end", (e) => {
      ended = true;
      onStatus(e as MessageEvent);
      setPhase("ended");
      es.close();
    });
    es.onerror = () => {
      if (ended) return;
      // EventSource retries on its own; a 4xx/5xx closes it for good.
      setPhase(es.readyState === EventSource.CLOSED ? "ended" : "reconnecting");
      if (es.readyState === EventSource.CLOSED) {
        setNotices((prev) => [...prev, "Lost the log stream."]);
      }
    };
    return () => es.close();
  }, [service.kind, service.id, deployment.deploymentId]);

  useEffect(() => {
    if (stick.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const failed = status === "error";
  const texts = failed ? lines.map((l) => l.text) : [];
  const culprit = failed ? (errorMessage ?? failureLine(texts)) : null;
  const why = failed ? explainDeployError(errorMessage ?? texts.join("\n")) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2 text-[11px] text-[var(--color-fg-muted)]">
        <span role="status" className="flex items-center gap-1.5">
          {phase === "ended" ? (
            "Log complete"
          ) : phase === "live" ? (
            <>
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-[var(--color-ok)]" />
              Streaming
            </>
          ) : (
            <>
              <Loader2 className="size-3 animate-spin" />
              {phase === "connecting" ? "Connecting…" : "Reconnecting…"}
            </>
          )}
        </span>
      </div>

      {failed && (culprit || why) && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] p-2.5 text-xs"
        >
          <div className="flex items-center gap-1.5 font-medium text-[var(--color-danger)]">
            <AlertTriangle className="size-3.5" /> Deploy failed
          </div>
          {why && <p className="mt-1 text-[var(--color-fg)]">{why}</p>}
          {culprit && (
            <p className="mt-1 break-words font-mono text-[11px] text-[var(--color-fg-muted)]">{culprit}</p>
          )}
        </div>
      )}

      {notices.map((n) => (
        <p key={n} className="text-[11px] text-[var(--color-warn)]">
          {n}
        </p>
      ))}

      <div
        ref={scrollRef}
        tabIndex={0}
        role="log"
        aria-label="Build and deploy log"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="max-h-80 min-h-24 overflow-auto rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-3 font-mono text-[11px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="flex items-center gap-2 text-[var(--color-fg-subtle)]">
            {phase === "ended" ? (
              "No log output."
            ) : (
              <>
                <Loader2 className="size-3.5 animate-spin" /> waiting for build output…
              </>
            )}
          </div>
        ) : (
          lines.map((l) => (
            <div
              key={l.id}
              className={cn(
                "whitespace-pre-wrap break-all",
                failed && l.text === culprit
                  ? "text-[var(--color-danger)]"
                  : "text-[var(--color-fg-muted)]"
              )}
            >
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- history ------------------------------------------------------------------

/**
 * Deploy history, newest first. Each row expands into its live log; the newest
 * deploy starts expanded while it is in flight (or when `openId` names one,
 * e.g. from the drawer's "View logs").
 */
export function DeploymentHistory({
  service,
  openId,
}: {
  service: Deployable;
  openId?: string | null;
}) {
  const deployments = sortedDeployments(service.deployments);
  const newest = deployments[0];
  const [expanded, setExpanded] = useState<string | null>(
    openId ?? (newest?.status === "running" ? newest.deploymentId : null)
  );
  // Auto-open a deploy that starts while the tab is showing (e.g. Redeploy).
  const [seenNewest, setSeenNewest] = useState(newest?.deploymentId);
  if (newest && newest.deploymentId !== seenNewest) {
    setSeenNewest(newest.deploymentId);
    if (newest.status === "running") setExpanded(newest.deploymentId);
  }
  const anyRunning = deployments.some((d) => d.status === "running");
  const now = useNow(anyRunning);

  return (
    <div className="space-y-2">
      <p className="mb-1 text-xs text-[var(--color-fg-muted)]">
        Deploys, newest first. Open one to see its build and deploy log.
      </p>
      {deployments.length === 0 ? (
        <p className="text-xs text-[var(--color-fg-subtle)]">
          No deploys yet — deploy this service to see its build log here.
        </p>
      ) : (
        deployments.map((d) => {
          const open = expanded === d.deploymentId;
          const started = d.createdAt ? Date.parse(d.createdAt) : NaN;
          const ended = d.finishedAt ? Date.parse(d.finishedAt) : NaN;
          const duration =
            d.status === "running" && !Number.isNaN(started)
              ? formatDuration(now - started)
              : !Number.isNaN(started) && !Number.isNaN(ended)
                ? formatDuration(ended - started)
                : null;
          return (
            <div
              key={d.deploymentId}
              className={cn(
                "rounded-lg border bg-[var(--color-surface)]",
                open ? "border-[var(--color-border-strong)]" : "border-[var(--color-border)]"
              )}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : d.deploymentId)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 shrink-0 text-[var(--color-fg-subtle)] transition-transform",
                      open && "rotate-90"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{d.title}</div>
                    <div className="text-[11px] text-[var(--color-fg-subtle)]">
                      {d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}
                      {duration && ` · ${duration}`}
                    </div>
                  </div>
                  <StatusPill status={d.status} />
                </button>
                {d.rollbackId && <RollbackButton rollbackId={d.rollbackId} title={d.title} />}
              </div>
              {open && (
                <div className="border-t border-[var(--color-border)] p-3">
                  <DeployLogs service={service} deployment={d} />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/** Restore a past deployment's image snapshot (image-based rollback). */
function RollbackButton({ rollbackId, title }: { rollbackId: string; title: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function rollback() {
    if (!confirm(`Roll back to "${title}"? This redeploys the recorded image.`)) return;
    setError(null);
    start(async () => {
      const res = await rollbackDeploymentAction(rollbackId);
      if (!res.ok) setError(res.error);
    });
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={rollback}
        disabled={pending}
        title="Roll back to this deployment"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] disabled:opacity-40"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        Roll back
      </button>
      {error && <span role="alert" className="text-[11px] text-[var(--color-danger)]">{error}</span>}
    </div>
  );
}

// --- drawer banner --------------------------------------------------------------

/** Failure reasons already read from a log, by deployment id (logs are immutable once failed). */
const reasonCache = new Map<string, string | null>();

/**
 * Why a failed deploy failed. Dokploy rarely fills `errorMessage`, so fall back
 * to replaying the finished log once and picking out the failure line (with a
 * plain-English cause for known signatures). Cached per deployment.
 */
function useFailureReason(service: Deployable, deployment: AppDeployment | undefined): string | null {
  const failedId =
    deployment?.status === "error" && !deployment.errorMessage ? deployment.deploymentId : null;
  const [reason, setReason] = useState<{ id: string; text: string | null } | null>(null);

  useEffect(() => {
    if (!failedId || reasonCache.has(failedId)) return;
    const lines: string[] = [];
    const es = new EventSource(
      `/api/services/deploy-logs?kind=${service.kind}` +
        `&id=${encodeURIComponent(service.id)}&deployment=${encodeURIComponent(failedId)}`
    );
    const settle = () => {
      es.close();
      const line = failureLine(lines);
      const why = explainDeployError(lines.join("\n"));
      const text = why ?? line;
      reasonCache.set(failedId, text);
      setReason({ id: failedId, text });
    };
    es.onmessage = (e) => {
      try {
        lines.push((JSON.parse(e.data) as { text: string }).text);
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("end", settle);
    es.onerror = settle;
    return () => es.close();
  }, [failedId, service.kind, service.id]);

  if (!deployment || deployment.status !== "error") return null;
  if (deployment.errorMessage) {
    return explainDeployError(deployment.errorMessage) ?? deployment.errorMessage;
  }
  if (!failedId) return null;
  return reasonCache.get(failedId) ?? (reason?.id === failedId ? reason.text : null);
}

/**
 * Railway-style "what's happening with my deploy" strip under the drawer
 * header: an in-flight deploy with elapsed time, or the latest failure with its
 * cause — each with a jump to the log. Renders nothing when all is quiet.
 */
export function DeployBanner({
  service,
  onViewLogs,
}: {
  service: Deployable;
  onViewLogs: (deploymentId: string) => void;
}) {
  const latest = sortedDeployments(service.deployments)[0];
  const running = latest?.status === "running";
  const now = useNow(running);
  const reason = useFailureReason(service, latest);
  if (!latest || (latest.status !== "running" && latest.status !== "error")) return null;

  const started = Date.parse(latest.createdAt);
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2.5 text-xs",
        running
          ? "border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)]"
          : "border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)]"
      )}
    >
      {running ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-[var(--color-warn)]" />
      ) : (
        <AlertTriangle className="size-4 shrink-0 text-[var(--color-danger)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium" style={{ color: running ? "var(--color-warn)" : "var(--color-danger)" }}>
          {running
            ? `Deploying${Number.isNaN(started) ? "…" : ` · ${formatDuration(now - started)}`}`
            : "Latest deploy failed"}
        </div>
        <div className="line-clamp-2 text-[var(--color-fg-muted)]" title={reason ?? undefined}>
          {running
            ? "Building and rolling out — logs stream live."
            : (reason ?? "Open the log to see what went wrong.")}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onViewLogs(latest.deploymentId)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5 font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
      >
        <ScrollText className="size-3.5" /> View logs
      </button>
    </div>
  );
}
