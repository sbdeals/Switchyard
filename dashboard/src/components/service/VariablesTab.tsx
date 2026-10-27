"use client";

import { useEffect, useReducer, useState, useTransition } from "react";
import type { Service } from "@/lib/dokploy";
import {
  loadServiceEnvAction,
  saveEnvironmentAction,
  saveApplicationEnvAction,
  saveComposeEnvAction,
} from "@/app/actions";
import { useSharedVariableKeys } from "@/components/use-shared-variables";
import { sharedReference, sharedReferences, type SharedScope } from "@/lib/shared-variables";
import { useDirtyGuard } from "@/components/DirtyGuard";
import { createEditorState, dotenvEditorReducer } from "@/lib/dotenv-editor";
import { appendDotenvKey, diffDotenvRaw, parseDotenvRaw, removeDotenvKey, setDotenvValue } from "@/lib/dotenv-raw";
import { Btn, inputCls, RemoveBtn, SaveRow, useSavedFlash } from "@/components/service/primitives";

export function VariablesTab({ service }: { service: Service }) {
  const serviceType = service.kind === "database" ? service.engine : service.kind;
  const [editor, dispatch] = useReducer(dotenvEditorReducer, null, createEditorState);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [pending, start] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const [addingReference, setAddingReference] = useState(false);
  const [scope, setScope] = useState<SharedScope>("project");
  const [referenceKey, setReferenceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  // Recheck definitions when a shared-variable save revalidates service props.
  const shared = useSharedVariableKeys(service.projectId, service.environmentId, service);
  const [exported, setExported] = useState<string | null>(null);

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

  const parsed = parseDotenvRaw(editor.text);
  const baseline = parseDotenvRaw(editor.baseline ?? "");
  const changes = diffDotenvRaw(baseline.variables, parsed.variables);
  const dirty = editor.baseline !== null && editor.loadError === null && editor.text !== editor.baseline;
  useDirtyGuard("Variables", dirty);
  const invalid = parsed.errors.length > 0;
  const reviewing = editor.review !== null;
  const count = Object.keys(parsed.variables).length;

  const availableKeys = shared?.keys?.[scope] ?? [];
  const selectedKey = availableKeys.includes(referenceKey) ? referenceKey : (availableKeys[0] ?? "");
  const references = shared?.keys ? sharedReferences(editor.text, shared.keys) : [];

  function insertReference() {
    if (pending || reviewing || invalid || !selectedKey) return;
    const key = targetKey.trim() || selectedKey;
    if (Object.hasOwn(parsed.variables, key)) {
      setError(`${key} already exists. Choose another service variable name or edit its existing value.`);
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      setError("Invalid key. Use letters, numbers and underscores; start with a letter or underscore.");
      return;
    }
    edit(appendDotenvKey(editor.text, key, sharedReference(scope, selectedKey)));
    setAddingReference(false);
    setTargetKey("");
  }

  function edit(text: string) {
    setError(null);
    setExported(null);
    dispatch({ type: "edit", text });
  }

  function save() {
    if (editor.review === null || invalid || !dirty) return;
    const value = editor.review;
    setError(null);
    start(async () => {
      try {
        const res =
          service.kind === "database"
            ? await saveEnvironmentAction(service.engine, service.id, value)
            : service.kind === "compose"
              ? await saveComposeEnvAction(service.id, value)
              : await saveApplicationEnvAction(service.id, value);
        if (res.ok) {
          dispatch({ type: "saved", text: value });
          flashSaved();
        } else setError(res.error);
      } catch {
        setError("Could not save variables. Try again.");
      }
    });
  }

  async function exportVariables() {
    if (!editor.exporting || invalid) return;
    const text = editor.text;
    setError(null);
    try {
      if (editor.exporting === "copy") {
        await navigator.clipboard.writeText(text);
        setExported("Copied as .env");
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "variables.env";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        setExported("Downloaded .env");
      }
      dispatch({ type: "cancelExport" });
    } catch {
      setError("Could not export variables. Try again or copy from the raw editor.");
    }
  }

  if (editor.loadError) {
    return <p role="alert" className="text-xs text-[var(--color-danger)]">{editor.loadError}</p>;
  }

  if (editor.baseline === null) {
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
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["rows", "raw"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={editor.mode === mode}
            disabled={pending || reviewing || (mode === "rows" && invalid)}
            onClick={() => dispatch({ type: "mode", mode })}
            className="rounded-lg border border-[var(--color-border-control)] px-3 py-2 text-xs text-[var(--color-fg-muted)] aria-pressed:bg-[var(--color-surface-hover)] aria-pressed:text-[var(--color-fg)] disabled:opacity-40"
          >
            {mode === "rows" ? "Row editor" : "Raw editor"}
          </button>
        ))}
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Btn disabled={pending || invalid} onClick={() => dispatch({ type: "export", kind: "copy" })}>Copy as .env</Btn>
          <Btn disabled={pending || invalid} onClick={() => dispatch({ type: "export", kind: "download" })}>Download .env</Btn>
        </div>
      </div>
      {editor.exporting && (
        <div role="alert" className="rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] p-3 text-xs">
          <p>This includes secret values from the current editor. Only share it with people you trust.</p>
          <div className="mt-2 flex gap-2">
            <Btn onClick={exportVariables}>{editor.exporting === "copy" ? "Copy secrets" : "Download secrets"}</Btn>
            <Btn onClick={() => dispatch({ type: "cancelExport" })}>Cancel export</Btn>
          </div>
        </div>
      )}
      {exported && <p role="status" className="text-xs text-[var(--color-ok)]">{exported}</p>}
      <p className="text-xs text-[var(--color-fg-muted)]">
        {reviewing ? "Review these changes, then confirm to save. Values are masked." : "Edit variables, then review before saving. Comments and formatting are preserved."}
        {" "}Redeploy the service for changes to take effect.
      </p>
      <div className="mb-3 space-y-2">
        <button type="button" disabled={pending || reviewing || invalid} onClick={() => setAddingReference(!addingReference)} aria-expanded={addingReference} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]">
          Add shared reference
        </button>
        {!shared && <p role="status" className="text-xs text-[var(--color-fg-muted)]">Checking shared variables…</p>}
        {shared?.error && <p role="alert" className="text-xs text-[var(--color-danger)]">{shared.error}</p>}
        {addingReference && !reviewing && shared?.keys && (
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
            <button type="button" onClick={insertReference} disabled={pending || invalid || !selectedKey} className="rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs text-white disabled:opacity-40">Insert reference</button>
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
      {!reviewing && (editor.mode === "raw" ? (
        <textarea
          value={editor.text}
          onChange={(e) => edit(e.target.value)}
          disabled={pending}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={"DATABASE_URL=postgres://…\nLOG_LEVEL=info"}
          aria-label="Environment variables, one KEY=value per line"
          aria-invalid={invalid}
          aria-describedby={invalid ? "dotenv-errors" : undefined}
          className="min-h-64 flex-1 resize-y rounded-lg border border-[var(--color-border-control)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
        />
      ) : (
        <div className="space-y-2">
          {Object.entries(parsed.variables).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-1/3 break-all font-mono text-xs">{key}</span>
              <textarea
                aria-label={`Value for ${key}`}
                value={value}
                rows={1}
                disabled={pending}
                spellCheck={false}
                onChange={(e) => edit(setDotenvValue(editor.text, key, e.target.value))}
                className={`${inputCls} min-w-0 flex-1 font-mono`}
              />
              <RemoveBtn label={`Remove ${key}`} pending={pending} onClick={() => edit(removeDotenvKey(editor.text, key))} />
            </div>
          ))}
          <form className="flex flex-wrap gap-2" onSubmit={(event) => {
            event.preventDefault();
            if (Object.hasOwn(parsed.variables, newKey)) {
              setError("That key already exists. Edit its value above.");
              return;
            }
            edit(appendDotenvKey(editor.text, newKey, newValue));
            setNewKey("");
            setNewValue("");
          }}>
            <input aria-label="New variable key" placeholder="KEY" required pattern="[A-Za-z_][A-Za-z0-9_]*" value={newKey} disabled={pending} onChange={(e) => setNewKey(e.target.value)} className={`${inputCls} min-w-0 flex-1 font-mono`} />
            <input aria-label="New variable value" placeholder="value" value={newValue} disabled={pending} onChange={(e) => setNewValue(e.target.value)} className={`${inputCls} min-w-0 flex-1 font-mono`} />
            <button type="submit" disabled={pending} className="rounded-lg border border-[var(--color-border-control)] px-3 py-2 text-xs disabled:opacity-40">Add variable</button>
          </form>
        </div>
      ))}
      {invalid && (
        <ul id="dotenv-errors" role="alert" className="space-y-1 text-xs text-[var(--color-danger)]">
          {parsed.errors.map((issue, index) => <li key={index}>Line {issue.line}: {issue.message}</li>)}
        </ul>
      )}
      {parsed.warnings.length > 0 && (
        <ul role="status" className="space-y-1 text-xs text-[var(--color-fg-muted)]">
          {parsed.warnings.map((issue, index) => <li key={index}>Line {issue.line}: {issue.message}</li>)}
          <li>Row edits update the last occurrence. Removing a key removes all its occurrences.</li>
        </ul>
      )}
      {!invalid && dirty && (
        <div aria-label="Variable changes" className="space-y-3 rounded-lg border border-[var(--color-border-control)] p-3 text-xs">
          {baseline.errors.length > 0 && <p>Stored syntax errors will be resolved.</p>}
          {baseline.errors.length === 0 && Object.values(changes).every((keys) => keys.length === 0) && <p>Only comments or formatting changed; variable values are unchanged.</p>}
          {(["added", "changed", "removed"] as const).map((kind) => (
            <div key={kind}>
              <p className="mb-1 font-medium capitalize">{kind} ({changes[kind].length})</p>
              {changes[kind].map((key) => <p key={key} className="break-all font-mono">{key}=••••••••</p>)}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--color-fg-subtle)]">{count} variable{count === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          {reviewing && <Btn disabled={pending} onClick={() => dispatch({ type: "cancelReview" })}>Back to editing</Btn>}
          <SaveRow saving={pending} saved={saved} error={error} disabled={!dirty || invalid} onSave={reviewing ? save : () => dispatch({ type: "review" })} label={reviewing ? "Confirm changes" : "Review changes"} />
        </div>
      </div>
    </div>
  );
}
