"use client";

import { useId, useMemo, useState } from "react";
import { Check, Copy, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import type { Service } from "@/lib/dokploy";
import { useStagedForm, useStagedState, useStaging } from "@/components/service/StagedChanges";
import { stagedVariableValues } from "@/lib/staged-collections";
import { decodeStoredEnv } from "@/lib/references";
import { referenceTargets } from "@/lib/reference-vars";
import { ContextMenu } from "@/components/ContextMenu";
import { variableMenuItems, type VariableMenuAction } from "@/lib/context-menu";
import { serializeVariableRows, validateVariableEntries, validateVariableRows, variableRows, type VariableRow } from "@/lib/variable-rows";
import { referenceSuggestions, validateVariableReferences, type ReferenceSuggestion } from "@/lib/variable-references";
import { VariableValueInput } from "@/components/service/VariableValueInput";

type TableRow = Pick<VariableRow, "index" | "key" | "value">;
interface TableDraft { template: string; rows: TableRow[] }

const buttonCls = "inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1.5 text-xs hover:bg-[var(--color-surface)] disabled:opacity-40";
const iconCls = "rounded p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] disabled:opacity-40";
const inputCls = "w-full min-w-0 rounded border border-[var(--color-border-control)] bg-[#0b0b10] p-2 font-mono text-xs outline-none focus:border-[var(--color-brand)] disabled:opacity-40";

/** Both editors modify the same env-text draft; only the staging bar applies it. */
export function VariablesTab({ service, services }: { service: Service; services: Service[] }) {
  const initial = decodeStoredEnv(service.env);
  const [value, setValue] = useStagedState("variables", initial);
  const { pending, revision } = useStaging();
  const [raw, setRaw] = useState(false);
  const [tableDraft, setTableDraft] = useStagedState<TableDraft | null>("variableRows", null);
  const [addedRow, setAddedRow] = useState<string | null>(null);
  const document = tableDraft ?? { template: value, rows: variableRows(value) };
  const rows = document.rows;
  const targets = useMemo(
    () => referenceTargets(services.filter((s) => s.projectId === service.projectId && s.environmentId === service.environmentId)),
    [services, service.projectId, service.environmentId]
  );
  const suggestions = useMemo(() => referenceSuggestions(services, service, value), [services, service, value]);
  const unparsedIssues = validateVariableRows(document.template)
    .filter((issue) => !variableRows(document.template).some((row) => row.index === issue.index));
  const issues = raw && !tableDraft
    ? [...validateVariableRows(value), ...validateVariableReferences(value, service.name, targets)]
    : [...unparsedIssues, ...validateVariableEntries(rows), ...validateVariableReferences(value, service.name, targets, rows)];

  useStagedForm({
    id: "variables",
    action: service.kind === "database" ? "saveEnvironmentAction"
      : service.kind === "compose" ? "saveComposeEnvAction" : "saveApplicationEnvAction",
    args: service.kind === "database" ? [service.engine, service.id, value] : [service.id, value],
    ...stagedVariableValues(initial, value),
    error: issues.length ? "Fix variable errors before deploying." : undefined,
  });

  function changeRows(nextRows: TableRow[]) {
    setTableDraft({ template: document.template, rows: nextRows });
    setValue(serializeVariableRows(document.template, nextRows));
  }

  function addRow() {
    const index = Math.max(document.template.split("\n").length, ...rows.map((row) => row.index + 1));
    setAddedRow(`${revision}:${index}`);
    changeRows([...rows, { index, key: "", value: "" }]);
  }

  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-xs text-[var(--color-fg-muted)]">
        Type <code className="font-mono">{"${{"}</code> in a value to reference a service variable or built-in.
        Edits are staged until you deploy.
      </p>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--color-fg-subtle)]">{rows.length} variable{rows.length === 1 ? "" : "s"}</span>
        <div className="flex gap-2">
          <button type="button" className={buttonCls} aria-pressed={raw} onClick={() => { setRaw(!raw); setAddedRow(null); }}>
            {raw ? "Table view" : "Raw editor"}
          </button>
          {!raw && <button type="button" className={buttonCls} disabled={pending} onClick={addRow}><Plus className="size-3.5" /> Add variable</button>}
        </div>
      </div>

      {raw ? (
        <textarea
          value={value}
          onChange={(e) => { setTableDraft(null); setValue(e.target.value); }}
          spellCheck={false}
          disabled={pending}
          placeholder={"DATABASE_URL=${{postgres.DATABASE_URL}}\nLOG_LEVEL=info"}
          aria-label="Environment variables, one KEY=value per line"
          aria-invalid={issues.length > 0}
          className={`${inputCls} min-h-64 flex-1 resize-none p-3 leading-relaxed`}
        />
      ) : (
        <table aria-label="Variables" className="w-full table-fixed text-left text-xs">
          <thead className="text-[var(--color-fg-subtle)]">
            <tr><th className="w-[30%] px-2 py-2 font-medium">Key</th><th className="px-2 py-2 font-medium">Value</th><th className="w-28 px-2 py-2 font-medium"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <VariableTableRow
                key={`${revision}:${row.index}`}
                row={row}
                autoEdit={addedRow === `${revision}:${row.index}`}
                pending={pending}
                suggestions={suggestions}
                issues={issues.filter((issue) => issue.index === row.index).map((issue) => issue.message)}
                onChange={(patch) => changeRows(rows.map((current) => current.index === row.index ? { ...current, ...patch } : current))}
                onRemove={() => {
                  changeRows(rows.filter((current) => current.index !== row.index));
                  setAddedRow(null);
                }}
              />
            ))}
            {!rows.length && <tr><td colSpan={3} className="rounded-lg border border-[var(--color-border)] p-6 text-center text-[var(--color-fg-subtle)]">No variables yet. Add a variable or paste into the raw editor.</td></tr>}
          </tbody>
        </table>
      )}

      {issues.some((issue) => raw || !rows.some((row) => row.index === issue.index)) && (
        <ul aria-label="Variable errors" className="mt-3 space-y-1 text-xs text-[var(--color-danger)]">
          {issues.filter((issue) => raw || !rows.some((row) => row.index === issue.index)).map((issue, index) => (
            <li key={index}>Line {issue.index + 1}: {issue.message}</li>
          ))}
        </ul>
      )}
      {!raw && <p className="mt-3 text-[11px] text-[var(--color-fg-subtle)]">Comments, quotes and blank lines are kept in the raw editor. Copy copies the template value; references resolve on deploy.</p>}
    </div>
  );
}

function VariableTableRow({ row, autoEdit, pending, suggestions, issues, onChange, onRemove }: {
  row: TableRow;
  autoEdit: boolean;
  pending: boolean;
  suggestions: ReferenceSuggestion[];
  issues: string[];
  onChange: (patch: { key?: string; value?: string }) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(autoEdit);
  const [revealed, setRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const errorId = useId();
  const label = row.key || "new variable";
  const edit = () => { setEditing(true); setCopyStatus(""); };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(row.value);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed. Reveal the value to copy it manually.");
    }
  };
  const actions: Record<VariableMenuAction, () => void | Promise<void>> = { copy, edit, delete: onRemove };
  const items = variableMenuItems({ reference: row.value.includes("${{"), pending })
    .map((item) => ({ ...item, onSelect: actions[item.id] }));

  return (
    <ContextMenu label={`${label} actions`} items={items}>
      {(trigger) => (
        <tr {...trigger} tabIndex={-1} className="border-t border-[var(--color-border)] align-top">
          <td className="p-2">
            {editing ? <input
              aria-label={`Key for ${label}`}
              aria-invalid={issues.length > 0}
              aria-describedby={issues.length ? errorId : undefined}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              value={row.key}
              placeholder="KEY"
              onChange={(e) => onChange({ key: e.target.value })}
              className={inputCls}
            /> : <button type="button" onClick={edit} disabled={pending} aria-label={`Edit ${label}`} className="w-full break-all py-1 text-left font-mono">{row.key || <span className="text-[var(--color-danger)]">Missing key</span>}</button>}
          </td>
          <td className="min-w-0 p-2">
            {editing ? <VariableValueInput
              value={row.value}
              editingKey={row.key}
              label={`Value for ${label}`}
              disabled={pending}
              suggestions={suggestions}
              invalid={issues.length > 0}
              describedBy={issues.length ? errorId : undefined}
              onChange={(next) => { setCopyStatus(""); onChange({ value: next }); }}
              className={inputCls}
            /> : <div className="whitespace-pre-wrap break-all py-1 font-mono">{revealed ? row.value || <span className="text-[var(--color-fg-subtle)]">Empty</span> : "••••••••"}</div>}
            {issues.length > 0 && <ul id={errorId} className="mt-1 space-y-1 text-[11px] text-[var(--color-danger)]">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
            {copyStatus && <p role="status" className="mt-1 text-[11px] text-[var(--color-fg-muted)]">{copyStatus}</p>}
          </td>
          <td className="p-2">
            <div className="flex flex-wrap justify-end gap-0.5">
              {editing ? <button type="button" onClick={() => { setEditing(false); setRevealed(false); }} disabled={pending} aria-label={`Done editing ${label}`} title="Done editing" className={iconCls}><Check className="size-3.5" /></button> : <>
                <button type="button" onClick={() => setRevealed(!revealed)} aria-label={`${revealed ? "Hide" : "Reveal"} ${label}`} title={revealed ? "Hide value" : "Reveal value"} className={iconCls}>{revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
                <button type="button" onClick={edit} disabled={pending} aria-label={`Edit value for ${label}`} title="Edit" className={iconCls}><Pencil className="size-3.5" /></button>
              </>}
              <button type="button" onClick={copy} aria-label={`Copy ${label}`} title="Copy value" className={iconCls}><Copy className="size-3.5" /></button>
              <button type="button" onClick={onRemove} disabled={pending} aria-label={`Delete ${label}`} title="Delete variable from draft" className={`${iconCls} hover:text-[var(--color-danger)]`}><Trash2 className="size-3.5" /></button>
            </div>
          </td>
        </tr>
      )}
    </ContextMenu>
  );
}
