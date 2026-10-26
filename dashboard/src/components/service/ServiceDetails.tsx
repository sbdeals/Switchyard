"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import type { Service } from "@/lib/dokploy";
import { serviceNameWarning, validateServiceName } from "@/lib/service-name";
import { updateServiceDetailsAction } from "@/app/actions";
import { Field, inputCls, SaveRow, useSavedFlash } from "./primitives";

export type RenameState = "editing" | "saving" | null;

function NameHint({ warning }: { warning: string | null }) {
  return (
    <div className="space-y-1 text-xs text-[var(--color-fg-muted)]">
      <p>Internal hostnames (appName) stay the same. Renaming does not restart the service.</p>
      {warning && <p role="status" className="text-[var(--color-warn)]">{warning}</p>}
    </div>
  );
}

export function ServiceName({
  service,
  services,
  titleId,
  renaming,
  onRenamingChange,
}: {
  service: Service;
  services: Service[];
  titleId: string;
  renaming: RenameState;
  onRenamingChange: (state: RenameState) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (wasRenaming.current && !renaming) buttonRef.current?.focus();
    wasRenaming.current = Boolean(renaming);
  }, [renaming]);

  return (
    <div className="min-w-0">
      <h2 id={titleId} className="font-semibold">
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Rename ${service.name}`}
          title="Rename service"
          hidden={Boolean(renaming)}
          onClick={() => onRenamingChange("editing")}
          className="group max-w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
        >
          <span className="break-all">{service.name}</span>
          <Pencil className="ml-1.5 inline size-3 text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg)]" />
        </button>
        {renaming && <span className="sr-only">{service.name}</span>}
      </h2>
      {renaming && (
        <InlineNameForm
          service={service}
          services={services}
          renaming={renaming}
          onRenamingChange={onRenamingChange}
        />
      )}
    </div>
  );
}

function InlineNameForm({
  service,
  services,
  renaming,
  onRenamingChange,
}: {
  service: Service;
  services: Service[];
  renaming: RenameState;
  onRenamingChange: (state: RenameState) => void;
}) {
  const [name, setName] = useState(service.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const hintId = useId();
  const validated = validateServiceName(name);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || renaming === "saving" || validated.error) return;
        setError(null);
        onRenamingChange("saving");
        start(async () => {
          const result = await updateServiceDetailsAction(service.id, { name: validated.name });
          if (!mounted.current) return;
          if (result.ok) onRenamingChange(null);
          else {
            setError(result.error);
            onRenamingChange("editing");
          }
        });
      }}
    >
      <input
        autoFocus
        onFocus={(e) => e.target.select()}
        aria-label="Service name"
        aria-describedby={hintId}
        aria-invalid={Boolean(validated.error)}
        value={name}
        disabled={pending}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        className={inputCls}
      />
      <div id={hintId}>
        <NameHint warning={serviceNameWarning(name, service, services)} />
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">Enter to save · Esc to cancel</p>
      </div>
      {(validated.error || error) && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">{validated.error || error}</p>
      )}
      <button type="submit" disabled={pending || Boolean(validated.error)} className="text-xs font-medium text-[var(--color-brand)] disabled:opacity-40">
        {pending ? "Saving…" : "Save name"}
      </button>
      <button type="button" disabled={pending} onClick={() => onRenamingChange(null)} className="ml-3 text-xs text-[var(--color-fg-muted)] disabled:opacity-40">
        Cancel
      </button>
    </form>
  );
}

export function ServiceDetailsSettings({ service, services }: { service: Service; services: Service[] }) {
  const [name, setName] = useState(service.name);
  const [description, setDescription] = useState(service.description ?? "");
  const [source, setSource] = useState({ name: service.name, description: service.description ?? "" });
  const [saving, startSave] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const validated = validateServiceName(name);
  const dirty = validated.name !== service.name || description !== (service.description ?? "");

  // A header rename refreshes props too; keep unrelated unsaved field edits.
  if (source.name !== service.name || source.description !== (service.description ?? "")) {
    setSource({ name: service.name, description: service.description ?? "" });
    if (name === source.name || name.trim() === service.name) setName(service.name);
    if (description === source.description) setDescription(service.description ?? "");
  }

  function save() {
    if (validated.error || saving) return;
    setError(null);
    startSave(async () => {
      const result = await updateServiceDetailsAction(service.id, { name: validated.name, description });
      if (result.ok) flashSaved();
      else setError(result.error);
    });
  }

  return (
    <section aria-label="Service details" className="mb-5 space-y-3 border-b border-[var(--color-border)] pb-5">
      <Field label="Service name" hint="1–63 characters">
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          aria-describedby={hintId}
          aria-invalid={Boolean(validated.error)}
          disabled={saving}
          className={inputCls}
        />
      </Field>
      <div id={hintId}><NameHint warning={serviceNameWarning(name, service, services)} /></div>
      <Field label="Description" hint="optional">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} rows={2} className={inputCls} />
      </Field>
      <SaveRow saving={saving} saved={saved} error={validated.error || error} disabled={!dirty || Boolean(validated.error)} onSave={save} label="Save details" />
    </section>
  );
}
