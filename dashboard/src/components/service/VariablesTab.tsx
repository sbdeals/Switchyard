"use client";

import { useEffect, useReducer, useState, useTransition } from "react";
import type { Service } from "@/lib/dokploy";
import { initialVariablesEditorState, variablesEditorReducer } from "@/lib/variables-editor";
import {
  loadServiceEnvAction,
  saveEnvironmentAction,
  saveApplicationEnvAction,
  saveComposeEnvAction,
} from "@/app/actions";
import { SaveRow, useSavedFlash } from "@/components/service/primitives";
import { useSharedVariableKeys } from "@/components/use-shared-variables";
import { setVariable, sharedReference, sharedReferences, variableValues, type SharedScope } from "@/lib/shared-variables";
import { useDirtyGuard } from "@/components/DirtyGuard";

export function VariablesTab({ service }: { service: Service }) {
  const serviceType = service.kind === "database" ? service.engine : service.kind;
  const [{ value, baseline, loadError }, dispatch] = useReducer(
    variablesEditorReducer,
    initialVariablesEditorState,
  );
  const [pending, start] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const [addingReference, setAddingReference] = useState(false);
  const [scope, setScope] = useState<SharedScope>("project");
  const [referenceKey, setReferenceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  // Recheck definitions when a shared-variable save revalidates service props.
  const shared = useSharedVariableKeys(service.projectId, service.environmentId, service);

  useEffect(() => {
    let live = true;
    loadServiceEnvAction(serviceType, service.id).then((res) => {
      if (!live) return;
      if (res.ok) {
        dispatch({ type: "loaded", env: res.env });
      } else {
        dispatch({ type: "failed", error: res.error });
      }
    }).catch(() => {
      if (live) dispatch({ type: "failed", error: "Could not load environment variables." });
    });
    return () => {
      live = false;
    };
  }, [serviceType, service.id]);

  const dirty = baseline !== null && loadError === null && value !== baseline;
  useDirtyGuard("Variables", dirty);
  const variables = variableValues(value);
  const count = Object.keys(variables).length;
  const availableKeys = shared?.keys?.[scope] ?? [];
  const selectedKey = availableKeys.includes(referenceKey) ? referenceKey : (availableKeys[0] ?? "");
  const references = shared?.keys ? sharedReferences(value, shared.keys) : [];

  function insertReference() {
    const key = targetKey.trim() || selectedKey;
    if (Object.hasOwn(variables, key)) {
      setError(`${key} already exists. Choose another service variable name or edit its existing value.`);
      return;
    }
    try {
      dispatch({ type: "edited", value: setVariable(value, key, sharedReference(scope, selectedKey)) });
      setError(null);
      setAddingReference(false);
      setTargetKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not insert reference.");
    }
  }

  function save() {
    setError(null);
    start(async () => {
      const res =
        service.kind === "database"
          ? await saveEnvironmentAction(service.engine, service.id, value)
          : service.kind === "compose"
            ? await saveComposeEnvAction(service.id, value)
            : await saveApplicationEnvAction(service.id, value);
      if (res.ok) {
        dispatch({ type: "saved", submittedValue: value });
        flashSaved();
      }
      else setError(res.error);
    });
  }

  if (loadError) {
    return <p role="alert" className="text-xs text-[var(--color-danger)]">{loadError}</p>;
  }

  if (baseline === null) {
    return (
      <div role="status" aria-label="Loading environment variables" className="space-y-3 animate-pulse">
        <span className="sr-only">Loading environment variables…</span>
        <div className="h-4 w-3/4 rounded bg-[var(--color-surface-hover)]" />
        <div className="h-64 rounded-lg bg-[var(--color-surface-hover)]" />
        <div className="h-8 w-28 rounded bg-[var(--color-surface-hover)]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-xs text-[var(--color-fg-muted)]">
        One <code className="font-mono">KEY=value</code> per line. Redeploy the service for
        changes to take effect.
      </p>
      <div className="mb-3 space-y-2">
        <button type="button" onClick={() => setAddingReference(!addingReference)} aria-expanded={addingReference} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]">
          Add shared reference
        </button>
        {!shared && <p role="status" className="text-xs text-[var(--color-fg-muted)]">Checking shared variables…</p>}
        {shared?.error && <p role="alert" className="text-xs text-[var(--color-danger)]">{shared.error}</p>}
        {addingReference && shared?.keys && (
          <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
            <p className="text-xs text-[var(--color-fg-muted)]">Manage shared values in Projects → project Settings → Shared variables.</p>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Shared reference scope" value={scope} onChange={(e) => { setScope(e.target.value as SharedScope); setReferenceKey(""); }} className="rounded border border-[var(--color-border-control)] bg-[var(--color-bg-elevated)] p-2 text-xs">
                <option value="project">Project</option>
                <option value="environment">Environment</option>
              </select>
              <select aria-label="Shared variable" value={selectedKey} onChange={(e) => setReferenceKey(e.target.value)} disabled={!availableKeys.length} className="min-w-0 flex-1 rounded border border-[var(--color-border-control)] bg-[var(--color-bg-elevated)] p-2 font-mono text-xs">
                {!availableKeys.length && <option value="">No shared variables in this scope</option>}
                {availableKeys.map((key) => <option key={key} value={key}>{key}</option>)}
              </select>
            </div>
            <input aria-label="Service variable name" value={targetKey} placeholder={selectedKey || "SERVICE_VARIABLE_NAME"} onChange={(e) => setTargetKey(e.target.value)} className="w-full rounded border border-[var(--color-border-control)] bg-[var(--color-bg-elevated)] p-2 font-mono text-xs" />
            <button type="button" onClick={insertReference} disabled={!selectedKey} className="rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs text-white disabled:opacity-40">Insert reference</button>
          </div>
        )}
        {references.length > 0 && (
          <ul aria-label="Shared reference status" className="space-y-1 text-xs">
            {references.map((ref, index) => (
              <li key={`${ref.variable}:${index}`} className={ref.defined ? "text-[var(--color-fg-muted)]" : "text-[var(--color-danger)]"}>
                <code>{ref.variable}: {ref.reference}</code> — {ref.defined ? "Defined" : "Missing — deployment will fail"}
              </li>
            ))}
          </ul>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => dispatch({ type: "edited", value: e.target.value })}
        spellCheck={false}
        placeholder={"DATABASE_URL=postgres://…\nLOG_LEVEL=info"}
        aria-label="Environment variables, one KEY=value per line"
        className="min-h-64 flex-1 resize-none rounded-lg border border-[var(--color-border-control)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
      />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[var(--color-fg-subtle)]">{count} variable{count === 1 ? "" : "s"}</span>
        <SaveRow saving={pending} saved={saved} error={error} disabled={!dirty} onSave={save} label="Save variables" />
      </div>
    </div>
  );
}
