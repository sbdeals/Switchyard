"use client";

import { useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Service } from "@/lib/dokploy";
import { appLifecycleAction, composeLifecycleAction, lifecycleAction } from "@/lib/client-actions";
import {
  BULK_ACTION_LABELS,
  canConfirmBulkAction,
  requiresStopConfirmation,
  runBulkAction,
  runServiceAction,
  type BulkAction,
  type BulkProgress,
} from "@/lib/bulk-actions";
import { useDialogFocus } from "@/components/use-focus-trap";
import { Btn, Field, inputCls } from "@/components/service/primitives";

/** The service snapshot stays fixed through revalidation and individual failures. */
export function BulkActionDialog({
  action,
  services,
  onClose,
}: {
  action: BulkAction;
  services: Service[];
  onClose: () => void;
}) {
  const titleId = useId();
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [progress, setProgress] = useState<BulkProgress[] | null>(null);
  const [pending, setPending] = useState(false);
  const started = useRef(false);
  const close = () => { if (!pending) onClose(); };
  const dialogRef = useDialogFocus<HTMLDivElement>(close);
  const label = BULK_ACTION_LABELS[action];
  const completed = progress?.filter((p) => p.status === "ok" || p.status === "failed").length ?? 0;
  const failed = progress?.filter((p) => p.status === "failed").length ?? 0;

  async function run() {
    if (started.current || !canConfirmBulkAction(action, services.length, confirmation)) return;
    started.current = true;
    setPending(true);
    try {
      await runBulkAction(services, (service) => runServiceAction(service, action, {
        database: lifecycleAction,
        application: appLifecycleAction,
        compose: composeLifecycleAction,
      }), setProgress);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl"
      >
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 id={titleId} className="text-sm font-semibold">{label} {services.length} selected services</h2>
          <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
            {action === "restart" ? "Each service will stop, then start. " : ""}
            Actions run two services at a time. Failures do not stop the remaining services.
          </p>
        </div>
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {services.map((service, index) => {
            const result = progress?.[index];
            return (
              <li key={`${service.kind}:${service.id}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 break-words text-sm font-medium">{service.name}</span>
                  {result && (
                    <span className={`flex shrink-0 items-center gap-1.5 text-xs ${result.status === "failed" ? "text-[var(--color-danger)]" : result.status === "ok" ? "text-[var(--color-ok)]" : "text-[var(--color-fg-muted)]"}`}>
                      {result.status === "running" && <Loader2 className="size-3 animate-spin" />}
                      {result.status === "ok" ? "OK" : result.status === "failed" ? "Failed" : result.status === "running" ? "Running" : "Queued"}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">{service.projectName} / {service.environmentName}</p>
                {result?.message && <p className="mt-1 break-words text-xs text-[var(--color-fg-muted)]">{result.message}</p>}
              </li>
            );
          })}
        </ul>
        <div className="space-y-3 border-t border-[var(--color-border)] px-5 py-4">
          <p role="status" aria-live="polite" className="text-xs text-[var(--color-fg-muted)]">
            {progress ? `${completed} of ${services.length} completed · ${failed} failed` : "Review the selected services before confirming."}
          </p>
          {progress === null && requiresStopConfirmation(action, services.length) && (
            <Field label='Type "stop" to confirm'>
              <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={inputCls} autoComplete="off" />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Btn onClick={close} disabled={pending}>{progress ? "Done" : "Cancel"}</Btn>
            {progress === null && (
              <Btn onClick={run} disabled={pending || !canConfirmBulkAction(action, services.length, confirmation)} primary>
                Confirm {label}
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
