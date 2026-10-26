"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { ProjectNode } from "@/lib/dokploy";
import { saveSharedVariablesAction } from "@/app/shared-variable-actions";
import { removeVariable, setVariable, variableValues, type SharedScope } from "@/lib/shared-variables";
import { SaveRow, useSavedFlash, inputCls } from "@/components/service/primitives";
import { useSharedVariables } from "@/components/use-shared-variables";

export function SharedVariablesPanel({ project }: { project: ProjectNode }) {
  const [environmentId, setEnvironmentId] = useState(project.environments[0]?.environmentId);
  const [drafts, setDrafts] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const result = useSharedVariables(project.projectId, environmentId);
  const rememberDraft = (key: string, value: string | undefined) => setDrafts((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Shared variables</h3>
        <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
          Reference these from a service’s Variables tab. Save, then redeploy each referencing service to apply changes.
        </p>
      </div>
      {project.environments.length > 0 && (
        <label className="block text-xs text-[var(--color-fg-muted)]">
          Environment
          <select aria-label="Shared variables environment" value={environmentId} disabled={Object.values(saving).some(Boolean)} onChange={(e) => setEnvironmentId(e.target.value)} className={`${inputCls} mt-1`}>
            {project.environments.map((env) => <option key={env.environmentId} value={env.environmentId}>{env.name}</option>)}
          </select>
        </label>
      )}
      {!result && <p role="status" className="text-xs text-[var(--color-fg-muted)]">Loading shared variables…</p>}
      {result?.error && <p role="alert" className="text-xs text-[var(--color-danger)]">{result.error}</p>}
      {result?.variables && (
        <>
          <SharedVariableEditor key={project.projectId} projectId={project.projectId} scope="project" initialValue={result.variables.project} initialDraft={drafts.project} onDraftChange={(value) => rememberDraft("project", value)} onSavingChange={(pending) => setSaving((current) => ({ ...current, project: pending }))} />
          {environmentId && <SharedVariableEditor key={environmentId} projectId={project.projectId} environmentId={environmentId} scope="environment" initialValue={result.variables.environment} initialDraft={drafts[environmentId]} onDraftChange={(value) => rememberDraft(environmentId, value)} onSavingChange={(pending) => setSaving((current) => ({ ...current, environment: pending }))} />}
        </>
      )}
    </div>
  );
}

export function SharedVariableEditor({ projectId, environmentId, scope, initialValue, initialDraft, onDraftChange, onSavingChange }: {
  projectId: string;
  environmentId?: string;
  scope: SharedScope;
  initialValue: string;
  initialDraft?: string;
  onDraftChange?: (value: string | undefined) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [value, setValue] = useState(initialDraft ?? initialValue);
  const [baseline, setBaseline] = useState(initialValue);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const variables = variableValues(value);
  const title = scope === "project" ? "Project variables" : "Environment variables";

  function changeValue(next: string) {
    setValue(next);
    onDraftChange?.(next === baseline ? undefined : next);
  }

  function edit(key: string, next: string) {
    try {
      changeValue(setVariable(value, key, next));
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update variable.");
      return false;
    }
  }

  function save() {
    setError(null);
    onSavingChange?.(true);
    start(async () => {
      try {
        const res = await saveSharedVariablesAction(projectId, environmentId, scope, value);
        if (res.ok) {
          setBaseline(value);
          onDraftChange?.(undefined);
          flashSaved();
        } else setError(res.error);
      } catch {
        setError("Could not save shared variables. Try again.");
      } finally {
        onSavingChange?.(false);
      }
    });
  }

  return (
    <section aria-label={title} className="space-y-3">
      <h4 className="text-xs font-semibold">{title}</h4>
      <p className="text-xs text-[var(--color-fg-subtle)]">
        Use <code>{`\${{${scope}.KEY}}`}</code>. Duplicate keys use the last value; deleting removes every occurrence.
      </p>
      <fieldset disabled={pending} className="min-w-0 space-y-2 disabled:opacity-60">
        <div role="table" aria-label={title} className="space-y-2">
          {Object.entries(variables).map(([key, val]) => (
            <VariableRow key={key} name={key} value={val} onChange={(next) => edit(key, next)} onRemove={() => changeValue(removeVariable(value, key))} />
          ))}
        </div>
        {Object.keys(variables).length === 0 && <p className="text-xs text-[var(--color-fg-subtle)]">No shared variables yet.</p>}
        <div className="rounded-lg border border-[var(--color-border)] p-2">
          <input aria-label={`New ${scope} variable name`} placeholder="VARIABLE_NAME" className={`${inputCls} mb-2 font-mono text-xs`} value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <VariableRow name={`New ${scope} variable`} value={newValue} onChange={setNewValue} />
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-fg-muted)] disabled:opacity-40" disabled={!newKey.trim()} onClick={() => {
            const key = newKey.trim();
            if (Object.hasOwn(variables, key)) { setError("This variable already exists. Edit its value above."); return; }
            if (edit(key, newValue)) { setNewKey(""); setNewValue(""); }
          }}><Plus className="size-3.5" /> Add variable</button>
        </div>
      </fieldset>
      <SaveRow saving={pending} saved={saved} error={error} disabled={value === baseline} onSave={save} label={`Save ${scope} variables`} />
    </section>
  );
}

/** Shared by both scopes; values stay masked until explicitly revealed. */
function VariableRow({ name, value, onChange, onRemove }: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  onRemove?: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const multiline = /[\r\n]/.test(value);
  return (
    <div role={onRemove ? "row" : undefined} className="space-y-1">
      {onRemove && <div role="cell" className="break-all font-mono text-xs">{name}</div>}
      <div role={onRemove ? "cell" : undefined} className="flex items-start gap-1">
        {revealed ? (
          <textarea aria-label={`${name} value`} value={value} onChange={(e) => onChange(e.target.value)} rows={2} spellCheck={false} className={`${inputCls} min-w-0 flex-1 font-mono text-xs`} />
        ) : (
          <input aria-label={`${name} value`} type="password" value={value} readOnly={multiline} title={multiline ? "Reveal to edit this multiline value" : undefined} onChange={(e) => onChange(e.target.value)} onPaste={(e) => {
            if (multiline) return;
            const pasted = e.clipboardData.getData("text");
            if (/[\r\n]/.test(pasted)) {
              e.preventDefault();
              const input = e.currentTarget;
              onChange(value.slice(0, input.selectionStart ?? 0) + pasted + value.slice(input.selectionEnd ?? value.length));
            }
          }} autoComplete="off" className={`${inputCls} min-w-0 flex-1 font-mono text-xs`} />
        )}
        <button type="button" aria-label={`${revealed ? "Hide" : "Reveal"} ${name}`} onClick={() => setRevealed(!revealed)} className="rounded p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]">{revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
        <button type="button" aria-label={`Copy ${name}`} onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setCopyError(false);
            setTimeout(() => setCopied(false), 1800);
          } catch { setCopyError(true); }
        }} className="rounded p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</button>
        {onRemove && <button type="button" aria-label={`Delete ${name}`} onClick={onRemove} className="rounded p-2 text-[var(--color-fg-muted)] hover:text-[var(--color-danger)]"><Trash2 className="size-4" /></button>}
      </div>
      {!revealed && multiline && <span className="text-xs text-[var(--color-fg-subtle)]">Reveal to edit this multiline value.</span>}
      {copied && <span role="status" className="text-xs text-[var(--color-ok)]">Copied</span>}
      {copyError && <span role="alert" className="text-xs text-[var(--color-danger)]">Could not copy. Reveal the value to copy it manually.</span>}
    </div>
  );
}
