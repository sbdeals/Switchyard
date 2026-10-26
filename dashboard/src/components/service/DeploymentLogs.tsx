"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Service } from "@/lib/dokploy";
import { deploymentForService } from "@/lib/deployment-logs";

export function DeploymentLogs({
  service,
  deploymentId,
  onRuntimeLogs,
}: {
  service: Service;
  deploymentId: string;
  onRuntimeLogs: () => void;
}) {
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const deployment = deploymentForService([service], service.id, deploymentId);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ serviceId: service.id, deploymentId });
    fetch(`/api/services/deployment-logs?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Deployment logs unavailable. Try again.");
        const result = await response.json() as { logs: string };
        if (!controller.signal.aborted) setLogs(result.logs);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Deployment logs unavailable.");
        }
      });
    return () => controller.abort();
  }, [service.id, deploymentId, attempt]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Deployment logs</h3>
          <p className="mt-1 truncate text-xs text-[var(--color-fg-muted)]">
            {deployment?.title ?? "Deployment"} · {deployment?.status ?? "completed"}
          </p>
          <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-fg-subtle)]">
            {deploymentId}
          </p>
        </div>
        <button
          type="button"
          onClick={onRuntimeLogs}
          className="shrink-0 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          Runtime logs
        </button>
      </div>
      {error ? (
        <div role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
          <button
            type="button"
            onClick={() => { setError(null); setAttempt((value) => value + 1); }}
            className="ml-2 underline"
          >
            Retry
          </button>
        </div>
      ) : logs === null ? (
        <p role="status" className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
          <Loader2 className="size-4 animate-spin" /> Loading deployment logs…
        </p>
      ) : (
        <pre
          tabIndex={0}
          aria-label="Deployment logs"
          className="flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-fg-muted)]"
        >
          {logs || "No logs were recorded for this deployment."}
        </pre>
      )}
      <p className="text-[10px] text-[var(--color-fg-subtle)]">Last 10,000 deployment log lines.</p>
    </div>
  );
}
