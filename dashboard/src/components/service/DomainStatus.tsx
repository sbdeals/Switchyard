"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { DomainStatus as DomainStatusResult } from "@/lib/domain-status";
import { domainStatusRows } from "@/lib/domain-status-presentation";

type Props = {
  serviceType: "application" | "compose";
  serviceId: string;
  domainId: string;
  host: string;
  https: boolean;
  path: string | null;
};

const pills = {
  ok: { label: "OK", className: "border-[var(--color-ok)]/30 bg-[var(--color-ok-soft)] text-[var(--color-ok)]" },
  warning: { label: "Warning", className: "border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)] text-[var(--color-warn)]" },
  error: { label: "Error", className: "border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] text-[var(--color-danger)]" },
};

export function DomainStatus(props: Props) {
  return <DomainHealthCheck key={`${props.serviceType}:${props.serviceId}:${props.domainId}:${props.host}:${props.https}:${props.path}`} {...props} />;
}

function DomainHealthCheck({ serviceType, serviceId, domainId, host, https }: Props) {
  const [result, setResult] = useState<DomainStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const query = new URLSearchParams({ serviceType, serviceId, domainId });
        const response = await fetch(`/api/services/domain-status?${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not check domain health");
        if (!controller.signal.aborted) setResult(body);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Could not check domain health");
        }
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }
    void check();
    return () => controller.abort();
  }, [serviceType, serviceId, domainId, revision]);

  const pill = error ? pills.error : result ? pills[result.level] : null;
  return (
    <div className="space-y-2 border-t border-[var(--color-border)] px-3 py-2.5 text-xs" aria-label={`Domain health for ${host}`} aria-busy={pending}>
      <div className="flex items-center gap-2">
        <span className="font-medium text-[var(--color-fg-muted)]">Domain health</span>
        <span role="status" className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${pending ? "border-[var(--color-border)] text-[var(--color-fg-subtle)]" : pill?.className}`}>
          {pending ? "Checking…" : pill?.label}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setError(null);
            setRevision((value) => value + 1);
          }}
          aria-label={`Re-check ${host}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Re-check
        </button>
      </div>
      {error && <p role="alert" className="text-[var(--color-danger)]">{error}</p>}
      {result && !error && (
        <>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5">
            {domainStatusRows(result, https).map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-[var(--color-fg-subtle)]">{row.label}</dt>
                <dd className="min-w-0 break-words text-[var(--color-fg-muted)]">{row.value}</dd>
              </div>
            ))}
          </dl>
          {result.reasons.length > 0 && (
            <p className={result.level === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-warn)]"}>
              {result.reasons.join(" · ")}
            </p>
          )}
          <p className="text-[10px] text-[var(--color-fg-subtle)]">
            Checked <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleTimeString()}</time> · Results cached for 30s
          </p>
        </>
      )}
    </div>
  );
}
