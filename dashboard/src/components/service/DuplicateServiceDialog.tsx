"use client";

import { useId, useState, useTransition } from "react";
import { Check, Copy, Loader2, Rocket, X } from "lucide-react";
import type { ProjectNode, Service } from "@/lib/dokploy";
import { duplicateServiceNameError } from "@/lib/service-duplicate";
import {
  appLifecycleAction,
  composeLifecycleAction,
  duplicateServiceAction,
  lifecycleAction,
} from "@/app/actions";
import { useDialogFocus } from "@/components/use-focus-trap";
import { inputCls } from "@/components/service/primitives";

export function DuplicateServiceDialog({
  service,
  projects,
  services,
  onClose,
  onCreated,
  onOpen,
}: {
  service: Service;
  projects: ProjectNode[];
  services: Service[];
  onClose: () => void;
  onCreated: () => void;
  onOpen: (id: string) => void;
}) {
  const [name, setName] = useState(`${service.name}-copy`);
  const [environmentId, setEnvironmentId] = useState(service.environmentId);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleId = useId();
  const nameErrorId = useId();
  const close = () => { if (!pending) onClose(); };
  const dialogRef = useDialogFocus<HTMLDivElement>(close);
  const environments = projects.find((project) => project.projectId === service.projectId)?.environments ?? [];
  const nameError = duplicateServiceNameError(
    name,
    services.filter((item) => item.environmentId === environmentId).map((item) => item.name)
  );
  const target = environments.find((environment) => environment.environmentId === environmentId);

  function duplicate() {
    if (pending || nameError || !target) return;
    setError(null);
    startTransition(async () => {
      try {
        const ref = service.kind === "database"
          ? { kind: service.kind, id: service.id, engine: service.engine }
          : { kind: service.kind, id: service.id };
        const result = await duplicateServiceAction(ref, name.trim(), environmentId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setCreatedId(result.id);
        onCreated();
      } catch {
        setError("Could not duplicate the service. Please try again.");
      }
    });
  }

  function deploy() {
    if (!createdId || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = service.kind === "database"
          ? await lifecycleAction(service.engine, createdId, "deploy")
          : service.kind === "compose"
            ? await composeLifecycleAction(createdId, "deploy")
            : await appLifecycleAction(createdId, "deploy");
        if (result.ok) onOpen(createdId);
        else setError(result.error);
      } catch {
        setError("Could not deploy the copy. You can retry or open its details.");
      }
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed left-1/2 top-1/2 z-[60] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
            {createdId ? <Check className="size-4" /> : <Copy className="size-4" />}
          </span>
          <h2 id={titleId} className="flex-1 text-sm font-semibold">
            {createdId ? "Service duplicated" : "Duplicate service"}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={pending}
            aria-label="Close duplicate service"
            className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        {createdId ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-[var(--color-fg-muted)]">
              <span className="font-medium text-[var(--color-fg)]">{name.trim()}</span> was created in {target?.name ?? service.environmentName} without deploying.
            </p>
            <p className="text-xs text-[var(--color-fg-subtle)]">Its volumes start empty. Domains and deployment history are not copied.</p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={() => onOpen(createdId)} className={secondaryButton}>
                View service
              </button>
              <button type="button" disabled={pending} onClick={deploy} className={primaryButton}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
                {pending ? "Deploying…" : "Deploy now"}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); duplicate(); }} className="space-y-4">
            <p className="text-xs text-[var(--color-fg-muted)]">
              Copy {service.name}&apos;s configuration with new empty volumes. Domains and deployment history are not copied.
            </p>
            <label className="block text-xs text-[var(--color-fg-muted)]">
              <span className="mb-1.5 block">New name</span>
              <input
                data-autofocus
                value={name}
                onChange={(event) => { setName(event.target.value); setError(null); }}
                disabled={pending}
                required
                aria-invalid={!!nameError}
                aria-describedby={nameError ? nameErrorId : undefined}
                className={inputCls}
              />
            </label>
            {nameError && <p id={nameErrorId} className="text-xs text-[var(--color-danger)]">{nameError}</p>}
            <label className="block text-xs text-[var(--color-fg-muted)]">
              <span className="mb-1.5 block">Target environment · {service.projectName}</span>
              <select
                value={environmentId}
                onChange={(event) => { setEnvironmentId(event.target.value); setError(null); }}
                disabled={pending}
                className={inputCls}
              >
                {environments.map((environment) => (
                  <option key={environment.environmentId} value={environment.environmentId}>{environment.name}</option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={close} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={pending || !!nameError || !target} className={primaryButton}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                {pending ? "Duplicating…" : "Duplicate service"}
              </button>
            </div>
          </form>
        )}
        {error && <p role="alert" className="mt-3 text-xs text-[var(--color-danger)]">{error}</p>}
      </div>
    </>
  );
}

const primaryButton = "inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40";
const secondaryButton = "rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] disabled:opacity-40";
