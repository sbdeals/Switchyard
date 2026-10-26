"use client";

import { createContext, useCallback, useContext, useEffect, useState, useTransition, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Loader2, Rocket, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Service } from "@/lib/dokploy";
import { applyStagedChangesAction } from "@/app/staged-actions";
import type { StagedAction, StagedApplyReport } from "@/lib/staged-apply";
import { displayStagedValue, emptyStagedState, stagedChangeCount, stagingReducer, type StagedOperation, type StagedState, type StagedEvent } from "@/lib/staged-changes";
import { useDialogFocus } from "@/components/use-focus-trap";

interface StagingContextValue {
  operations: StagedOperation[];
  drafts: Record<string, unknown>;
  stage: (operation: StagedOperation) => void;
  discard: (id?: string) => void;
  setDraft: (key: string, value: unknown) => void;
  pending: boolean;
  setBarContainer: (node: HTMLDivElement | null) => void;
  hasChanges: boolean;
  deploy: (serviceId?: string) => void;
  hasServiceChanges: (serviceId: string) => boolean;
  revision: number;
  requestLeave: (proceed: () => void) => void;
}

const StagingContext = createContext<StagingContextValue | null>(null);
const buttonCls = "rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-50";

/** Drafts stay in memory per service, including while its drawer is closed. */
export function StagingProvider({ service: selectedService, services, children }: { service: Service | null; services: Service[]; children: ReactNode }) {
  const [states, setStates] = useState<Record<string, StagedState>>({});
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [reports, setReports] = useState<Record<string, StagedApplyReport>>({});
  const [networkingPending, setNetworkingPending] = useState<Record<string, boolean>>({});
  const [reportLabels, setReportLabels] = useState<Record<string, Record<string, string>>>({});
  const [needsDeploy, setNeedsDeploy] = useState<Record<string, boolean>>({});
  const [barContainer, setBarContainer] = useState<HTMLDivElement | null>(null);
  const [details, setDetails] = useState(false);
  const [leaving, setLeaving] = useState<{ proceed: () => void; navigation?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [requestError, setRequestError] = useState<string | null>(null);
  const router = useRouter();
  const service = selectedService ?? services.find((item) => {
    const id = `${item.kind}:${item.id}`;
    return states[id]?.operations.length || needsDeploy[id];
  }) ?? services.find((item) => reports[`${item.kind}:${item.id}`]) ?? null;
  const key = service ? `${service.kind}:${service.id}` : "";
  const state = states[key] ?? emptyStagedState();
  const count = stagedChangeCount(state.operations);
  const report = reports[key];
  const awaitingDeploy = needsDeploy[key] ?? false;
  const hasChanges = count > 0 || awaitingDeploy;
  const anyChanges = Object.values(states).some((entry) => entry.operations.length) || Object.values(needsDeploy).some(Boolean);

  const dispatch = useCallback((event: StagedEvent) => {
    setStates((current) => {
      const previous = current[key] ?? emptyStagedState();
      const next = stagingReducer(previous, event);
      return next === previous ? current : { ...current, [key]: next };
    });
  }, [key]);
  const stage = useCallback((operation: StagedOperation) => dispatch({ type: "stage", operation }), [dispatch]);
  const setDraft = useCallback((draftKey: string, value: unknown) => dispatch({ type: "draft", key: draftKey, value }), [dispatch]);
  const discard = useCallback((id?: string) => {
    dispatch({ type: "discard", id });
    if (!id) setRevisions((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
  }, [dispatch, key]);
  const requestLeave = useCallback((proceed: () => void) => {
    if (pending) return;
    if (hasChanges) setLeaving({ proceed });
    else proceed();
  }, [hasChanges, pending]);

  useEffect(() => {
    if (!anyChanges && !pending) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      if (!pending) setLeaving({ proceed: () => window.location.assign(link.href), navigation: true });
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [anyChanges, pending]);

  function hasServiceChanges(serviceId: string) {
    const target = services.find((item) => item.id === serviceId);
    const id = target ? `${target.kind}:${target.id}` : "";
    return !!states[id]?.operations.length || !!needsDeploy[id];
  }

  function deploy(serviceId = service?.id) {
    const target = services.find((item) => item.id === serviceId);
    if (!target || pending) return;
    const targetKey = `${target.kind}:${target.id}`;
    const targetState = states[targetKey] ?? emptyStagedState();
    if (targetState.operations.some((op) => op.error)) return;
    const submitted = targetState.operations;
    setRequestError(null);
    start(async () => {
      try {
        const result = await applyStagedChangesAction({
          kind: target.kind, id: target.id, networkingChanged: networkingPending[targetKey] ?? false,
          ...(target.kind === "database" ? { engine: target.engine, appName: target.appName } : {}),
        }, submitted);
        setReports((current) => ({ ...current, [targetKey]: result }));
        setReportLabels((current) => ({ ...current, [targetKey]: Object.fromEntries(submitted.map((op) => [op.id, op.changes.map((change) => change.field).join(", ")])) }));
        setNetworkingPending((current) => ({ ...current, [targetKey]: result.deploy !== "succeeded" && (current[targetKey] || submitted.some((op) => result.applied.includes(op.id) && /DomainAction$/.test(op.action))) }));
        setStates((current) => ({ ...current, [targetKey]: stagingReducer(current[targetKey] ?? emptyStagedState(), { type: "applied", ids: result.applied }) }));
        setNeedsDeploy((current) => ({ ...current, [targetKey]: result.deploy !== "succeeded" && (needsDeploy[targetKey] || result.applied.length > 0 || !!result.failed?.appliedSteps?.length) }));
        if (result.ok) {
          setStates((current) => ({ ...current, [targetKey]: emptyStagedState() }));
          setRevisions((current) => ({ ...current, [targetKey]: (current[targetKey] ?? 0) + 1 }));
          setDetails(false);
        }
        router.refresh();
      } catch {
        // A lost response cannot prove whether a mutation or deploy completed.
        setRequestError("The request was interrupted. Its outcome is unknown. Refresh and check deployments and settings before retrying.");
      }
    });
  }

  const value: StagingContextValue = { operations: state.operations, drafts: state.drafts, stage, discard, setDraft, pending, setBarContainer, hasChanges, deploy, hasServiceChanges, revision: revisions[key] ?? 0, requestLeave };
  const describe = (id: string) => reportLabels[key]?.[id] ?? id;
  const bar = service && (hasChanges || report || requestError) && (
        <div className={`${barContainer ? "mx-4 mt-3" : "fixed top-24 left-1/2 w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2"} z-[55] rounded-xl border border-[var(--color-brand)]/50 bg-[var(--color-bg-elevated)] shadow-2xl`} aria-label="Staged changes">
          {(report || requestError) && (
            <div role="status" className="border-b border-[var(--color-border)] px-4 py-2 text-xs">
              {requestError ?? (report?.ok ? "Changes applied. Deployment triggered." : <>
                {report?.applied.length ? `Applied: ${report.applied.map(describe).join(", ")}. ` : "No complete changes applied. "}
                {report?.failed && <>Failed: {describe(report.failed.id)}{report.failed.failedStep ? ` (${report.failed.failedStep})` : ""}. {report.failed.error} </>}
                {!!report?.failed?.appliedSteps?.length && <>Applied steps: {report.failed.appliedSteps.join(", ")}. </>}
                {!!report?.skipped.length && <>Not applied: {report.skipped.map(describe).join(", ")}. </>}
                {report?.deploy === "failed" ? `Deploy failed. ${report.error ?? ""}` : "Deploy was not triggered."}
              </>)}
              {!hasChanges && <button className="ml-2 underline" onClick={() => { setReports((current) => { const next = { ...current }; delete next[key]; return next; }); setRequestError(null); }}>Dismiss</button>}
            </div>
          )}
          {hasChanges && <div className="flex flex-wrap items-center gap-2 p-3">
            <span className="mr-auto text-sm font-medium">{count} {count === 1 ? "change" : "changes"}{awaitingDeploy && count === 0 ? " · Deploy pending" : ""}<span className="ml-2 text-xs text-[var(--color-fg-muted)]">{service.name}</span></span>
            <button className={buttonCls} onClick={() => setDetails(true)}>Details</button>
            <button className={buttonCls} disabled={pending || count === 0} onClick={() => { discard(); setDetails(false); }}>Discard</button>
            <button className={`${buttonCls} flex items-center gap-1.5 bg-[var(--color-brand)] text-white`} disabled={pending || state.operations.some((op) => !!op.error)} onClick={() => deploy()}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />} {pending ? "Deploying…" : "Deploy"}
            </button>
          </div>}
        </div>
      );
  return (
    <StagingContext.Provider value={value}>
      {children}
      {barContainer ? createPortal(bar, barContainer) : bar}
      {details && service && <StagedDialog title={`${count} changes to apply`} onClose={() => setDetails(false)}>
        <p className="mb-3 text-xs text-[var(--color-fg-muted)]">{service.name} will deploy once after all changes apply. Drafts are kept in this workspace until you reload or leave the page.</p>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full table-fixed text-left text-xs">
            <thead><tr className="text-[var(--color-fg-muted)]"><th className="p-2">Field</th><th className="p-2">Current</th><th className="p-2">New</th></tr></thead>
            <tbody>{state.operations.flatMap((op) => op.changes.map((change) => <tr key={`${op.id}:${change.field}`} className="border-t border-[var(--color-border)]">
              <td className="break-words p-2">{change.field}{op.error && <p className="text-[var(--color-danger)]">{op.error}</p>}</td>
              <td className="whitespace-pre-wrap break-words p-2 font-mono text-[var(--color-fg-muted)]">{displayStagedValue(change.before, change.secret)}</td>
              <td className="whitespace-pre-wrap break-words p-2 font-mono">{displayStagedValue(change.after, change.secret)}</td>
            </tr>))}</tbody>
          </table>
        </div>
        {awaitingDeploy && <p className="mt-3 text-xs">Some settings are already saved. Discard only removes edits that have not applied; Deploy applies the remaining edits and triggers a deployment.</p>}
      </StagedDialog>}
      {leaving && <StagedDialog title="Keep staged changes?" onClose={() => setLeaving(null)}>
        <p className="text-sm text-[var(--color-fg-muted)]">{leaving.navigation ? "Leaving this page loses drafts. Keep editing or discard the drafts and leave." : "Keep your changes to deploy later, or discard the edits that have not applied."}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className={buttonCls} onClick={() => { const next = leaving; setLeaving(null); if (!next.navigation) next.proceed(); }}>{leaving.navigation ? "Keep editing" : "Keep changes"}</button>
          <button className={buttonCls} onClick={() => {
            const next = leaving;
            if (next.navigation) { setStates({}); setNeedsDeploy({}); } else discard();
            setLeaving(null);
            // Let beforeunload observe the discarded state before navigating.
            if (next.navigation) setTimeout(next.proceed, 0); else next.proceed();
          }}>Discard{leaving.navigation ? " and leave" : " changes"}</button>
        </div>
      </StagedDialog>}
    </StagingContext.Provider>
  );
}

function StagedDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="w-full max-w-2xl rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-2xl">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2><button aria-label="Close dialog" onClick={onClose}><X className="size-4" /></button></div>
      {children}
    </div>
  </div>;
}

export function useOptionalStaging() {
  return useContext(StagingContext);
}

export function useStaging(): StagingContextValue {
  const context = useOptionalStaging();
  if (!context) throw new Error("Service settings require a staging provider.");
  return context;
}

export function useStagedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const { drafts, setDraft } = useStaging();
  const value = Object.hasOwn(drafts, key) ? drafts[key] as T : initial;
  const setValue: Dispatch<SetStateAction<T>> = (next) => setDraft(key, typeof next === "function" ? (next as (value: T) => T)(value) : next);
  return [value, setValue];
}

export function useStagedForm({ id, action, args, before, after, secretFields = [], error }: {
  id: string; action: string; args: unknown[]; before: Record<string, unknown>; after: Record<string, unknown>; secretFields?: string[]; error?: string;
}) {
  const { stage } = useStaging();
  const serialized = JSON.stringify({ id, action, args, error, changes: [...new Set([...Object.keys(before), ...Object.keys(after)])].map((field) => ({ field, before: before[field], after: after[field], secret: secretFields.includes(field) })) });
  useEffect(() => {
    stage(JSON.parse(serialized) as StagedOperation & { action: StagedAction });
  }, [serialized, stage]);
}
