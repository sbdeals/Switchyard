"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Link2, X } from "lucide-react";
import type { Service } from "@/lib/dokploy";
import {
  saveEnvironmentAction,
  saveApplicationEnvAction,
  saveComposeEnvAction,
} from "@/app/actions";
import { SaveRow, useSavedFlash } from "@/components/service/primitives";
import { decodeStoredEnv, resolveTemplate } from "@/lib/references";
import { referenceTargets, referenceableKeys } from "@/lib/reference-vars";
import { serviceLabel } from "@/lib/service-meta";
import { cn } from "@/lib/utils";

/**
 * Service variables with Railway-style references. The textarea edits the
 * TEMPLATE (`DATABASE_URL=${{postgres.DATABASE_URL}}`); references are checked
 * live against the workspace and expanded server-side on save and before each
 * deploy (see lib/references.ts for syntax and storage).
 */
export function VariablesTab({ service, services }: { service: Service; services: Service[] }) {
  const initial = decodeStoredEnv(service.env);
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = value !== initial;
  const count = value.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;

  const targets = useMemo(
    () => referenceTargets(services, service.environmentId),
    [services, service.environmentId]
  );
  const resolution = useMemo(
    () => resolveTemplate(value, service.name, targets),
    [value, service.name, targets]
  );
  const refKeys = [...resolution.referencing];
  const issueKeys = new Set(resolution.issues.map((i) => i.key));

  function save() {
    setError(null);
    start(async () => {
      const res =
        service.kind === "database"
          ? await saveEnvironmentAction(service.engine, service.id, value)
          : service.kind === "compose"
            ? await saveComposeEnvAction(service.id, value)
            : await saveApplicationEnvAction(service.id, value);
      if (res.ok) flashSaved();
      else setError(res.error);
    });
  }

  /**
   * Insert a reference at the cursor. On an empty line, write a whole
   * `VAR=${{Service.VAR}}` entry; inside a value, just the reference.
   */
  function insertReference(target: Service, variable: string) {
    const ref = `\${{${target.name}.${variable}}}`;
    const el = textareaRef.current;
    const pos = el ? el.selectionStart : value.length;
    const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
    const lineEndIdx = value.indexOf("\n", pos);
    const line = value.slice(lineStart, lineEndIdx === -1 ? value.length : lineEndIdx);
    let next: string;
    let caret: number;
    if (!el || line.trim() === "") {
      const entry = `${variable}=${ref}`;
      if (el) {
        next = value.slice(0, lineStart) + entry + value.slice(lineStart + line.length);
        caret = lineStart + entry.length;
      } else {
        const sep = value && !value.endsWith("\n") ? "\n" : "";
        next = `${value}${sep}${entry}`;
        caret = next.length;
      }
    } else {
      next = value.slice(0, pos) + ref + value.slice(el.selectionEnd);
      caret = pos + ref.length;
    }
    setValue(next);
    setPickerOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs text-[var(--color-fg-muted)]">
          One <code className="font-mono">KEY=value</code> per line. Reference another service with{" "}
          <code className="font-mono">{"${{Service.VAR}}"}</code> — resolved when you save and
          before every deploy. Redeploy for changes to take effect.
        </p>
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          aria-expanded={pickerOpen}
          aria-controls="reference-picker"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
        >
          <Link2 className="size-3.5" /> Add reference
        </button>
      </div>

      {pickerOpen && (
        <ReferencePicker
          self={service}
          services={services}
          onPick={insertReference}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        placeholder={"DATABASE_URL=${{postgres.DATABASE_URL}}\nLOG_LEVEL=info"}
        aria-label="Environment variables, one KEY=value per line"
        className="min-h-64 flex-1 resize-none rounded-lg border border-[var(--color-border-control)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
      />

      {(refKeys.length > 0 || resolution.issues.length > 0) && (
        <ul aria-label="Reference status" className="mt-3 space-y-1 text-[11px]">
          {refKeys
            .filter((k) => !issueKeys.has(k))
            .map((k) => (
              <li key={k} className="flex items-center gap-1.5 text-[var(--color-fg-muted)]">
                <CheckCircle2 className="size-3.5 shrink-0 text-[var(--color-ok)]" />
                <span className="font-mono">{k}</span> resolves
              </li>
            ))}
          {resolution.issues.map((i) => (
            <li
              key={`${i.key}|${i.ref}|${i.message}`}
              className="flex items-start gap-1.5 text-[var(--color-danger)]"
            >
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span>
                <span className="font-mono">{i.key}</span>: <span className="font-mono">{i.ref}</span> —{" "}
                {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[var(--color-fg-subtle)]">
          {count} variable{count === 1 ? "" : "s"}
        </span>
        <SaveRow
          saving={pending}
          saved={saved}
          error={error}
          disabled={!dirty || resolution.issues.length > 0}
          onSave={save}
          label="Save variables"
        />
      </div>
    </div>
  );
}

/** Sibling services and the variables each can be referenced by. */
function ReferencePicker({
  self,
  services,
  onPick,
  onClose,
}: {
  self: Service;
  services: Service[];
  onPick: (target: Service, variable: string) => void;
  onClose: () => void;
}) {
  // Same-environment services first — that's what a bare name resolves to.
  const others = services
    .filter((s) => s.id !== self.id)
    .sort(
      (a, b) =>
        Number(b.environmentId === self.environmentId) - Number(a.environmentId === self.environmentId)
    );
  const [open, setOpen] = useState<string | null>(others.length === 1 ? others[0].id : null);

  return (
    <div
      id="reference-picker"
      role="region"
      aria-label="Insert a reference"
      className="mb-3 max-h-72 overflow-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2"
    >
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
          Reference a variable from
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close reference picker"
          className="rounded p-0.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {others.length === 0 ? (
        <p className="px-1 py-2 text-xs text-[var(--color-fg-subtle)]">
          No other services yet. Add a database or app, then reference its variables here.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {others.map((s) => {
            const expanded = open === s.id;
            const { own, builtin } = referenceableKeys(s);
            return (
              <li key={`${s.kind}:${s.id}`}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : s.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-[var(--color-surface-hover)]"
                >
                  <ChevronRight
                    className={cn("size-3.5 text-[var(--color-fg-subtle)] transition-transform", expanded && "rotate-90")}
                  />
                  <span className="font-medium">{s.name}</span>
                  <span className="text-[var(--color-fg-subtle)]">
                    {serviceLabel(s)}
                    {s.environmentId !== self.environmentId && ` · ${s.projectName} / ${s.environmentName}`}
                  </span>
                </button>
                {expanded && (
                  <div className="mb-1 ml-6 flex flex-wrap gap-1 py-1">
                    {[...builtin.map((k) => ({ k, builtin: true })), ...own.map((k) => ({ k, builtin: false }))].map(
                      ({ k, builtin: isBuiltin }) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => onPick(s, k)}
                          title={isBuiltin ? "Provided by Switchyard" : "Defined in this service's Variables"}
                          className={cn(
                            "rounded-md border px-1.5 py-0.5 font-mono text-[11px] hover:border-[var(--color-brand)] hover:text-[var(--color-fg)]",
                            isBuiltin
                              ? "border-[var(--color-brand)]/30 text-[var(--color-brand)]"
                              : "border-[var(--color-border-strong)] text-[var(--color-fg-muted)]"
                          )}
                        >
                          {k}
                        </button>
                      )
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
