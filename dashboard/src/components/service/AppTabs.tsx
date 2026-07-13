"use client";

import { useState, useTransition } from "react";
import { Globe, ExternalLink, Plus, Loader2, Pencil, Trash2, X } from "lucide-react";
import type { Application, AppDomain, CertificateType, DomainInput } from "@/lib/dokploy";
import {
  appLifecycleAction,
  updateApplicationAction,
  createDomainAction,
  updateDomainAction,
  deleteDomainAction,
} from "@/app/actions";
import {
  inputCls,
  Field,
  Info,
  LifecycleButtons,
  SaveRow,
  DangerZone,
  useLifecycle,
  useSavedFlash,
} from "@/components/service/primitives";

const CERT_TYPES: CertificateType[] = ["none", "letsencrypt", "custom"];

const useAppLifecycle = (app: Application) =>
  useLifecycle((action) => appLifecycleAction(app.id, action));

export function AppOverviewTab({ app }: { app: Application }) {
  const { pending, error, run } = useAppLifecycle(app);
  const primary = app.domains[0];

  return (
    <div className="space-y-5">
      <LifecycleButtons status={app.status} pending={pending} error={error} run={run} />

      <Field label="Public URL">
        {primary ? (
          <a
            href={`${primary.https ? "https" : "http"}://${primary.host}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm text-[var(--color-brand)] hover:underline"
          >
            <Globe className="size-3.5" /> {primary.host}
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <p className="text-xs text-[var(--color-fg-subtle)]">
            No domain yet — add one in the Domains tab.
          </p>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Info label="Source" value={app.sourceType ?? "—"} />
        <Info
          label={app.sourceType === "docker" ? "Image" : "Repository"}
          value={app.dockerImage ?? app.repository ?? "—"}
          mono
        />
        <Info label="Build" value={app.buildType ?? "—"} />
        <Info label="Replicas" value={String(app.replicas ?? 1)} />
      </div>
    </div>
  );
}

/** Shared host/port/https/cert-type editor used by the add form and edit rows. */
function DomainFields({
  value,
  onChange,
}: {
  value: DomainInput;
  onChange: (patch: Partial<DomainInput>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Host">
            <input
              value={value.host}
              onChange={(e) => onChange({ host: e.target.value })}
              placeholder="app.example.com"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="w-24">
          <Field label="Container port">
            <input
              value={String(value.port)}
              onChange={(e) => onChange({ port: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
              className={inputCls}
            />
          </Field>
        </div>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Certificate">
            <select
              value={value.certificateType}
              onChange={(e) => onChange({ certificateType: e.target.value as CertificateType })}
              className={inputCls}
            >
              {CERT_TYPES.map((c) => (
                <option key={c} value={c}>
                  {c === "letsencrypt" ? "Let's Encrypt" : c === "none" ? "None (HTTP)" : "Custom"}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-fg-muted)]">
          <input
            type="checkbox"
            checked={value.https}
            onChange={(e) => onChange({ https: e.target.checked })}
          />
          HTTPS
        </label>
      </div>
    </div>
  );
}

function toInput(d: AppDomain): DomainInput {
  return {
    host: d.host,
    port: d.port ?? 80,
    https: d.https,
    certificateType: d.certificateType,
    path: d.path ?? "/",
  };
}

/** One attached domain: display row that expands into an inline editor. */
function DomainRow({ d }: { d: AppDomain }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DomainInput>(() => toInput(d));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!draft.host.trim()) return;
    setError(null);
    start(async () => {
      const res = await updateDomainAction(d.domainId, draft);
      if (res.ok) setEditing(false);
      else setError(res.error);
    });
  }

  function remove() {
    if (!confirm(`Remove domain "${d.host}"?`)) return;
    setError(null);
    start(async () => {
      const res = await deleteDomainAction(d.domainId);
      if (!res.ok) setError(res.error);
    });
  }

  if (editing) {
    return (
      <div className="space-y-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
        <DomainFields value={draft} onChange={(patch) => setDraft((v) => ({ ...v, ...patch }))} />
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => {
              setDraft(toInput(d));
              setEditing(false);
              setError(null);
            }}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
          >
            <X className="size-3.5" /> Cancel
          </button>
          <button
            onClick={save}
            disabled={pending || !draft.host.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
      <Globe className="size-3.5 shrink-0 text-[var(--color-brand)]" />
      <a
        href={`${d.https ? "https" : "http"}://${d.host}`}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-1 items-center gap-1.5 truncate hover:underline"
      >
        <span className="truncate">{d.host}</span>
        {d.port && <span className="text-xs text-[var(--color-fg-subtle)]">:{d.port}</span>}
        <ExternalLink className="size-3 shrink-0 text-[var(--color-fg-subtle)]" />
      </a>
      <span className="shrink-0 rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-subtle)]">
        {d.certificateType === "letsencrypt" ? "LE" : d.https ? "HTTPS" : "HTTP"}
      </span>
      <button
        onClick={() => {
          setDraft(toInput(d));
          setEditing(true);
        }}
        disabled={pending}
        className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40"
        title="Edit domain"
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        onClick={remove}
        disabled={pending}
        className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)] disabled:opacity-40"
        title="Remove domain"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </button>
      {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
    </div>
  );
}

const NEW_DOMAIN: DomainInput = {
  host: "",
  port: 80,
  https: true,
  certificateType: "letsencrypt",
  path: "/",
};

export function DomainsTab({ app }: { app: Application }) {
  const [draft, setDraft] = useState<DomainInput>(NEW_DOMAIN);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (!draft.host.trim()) return;
    setError(null);
    start(async () => {
      const res = await createDomainAction(app.id, draft);
      if (res.ok) setDraft(NEW_DOMAIN);
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-fg-muted)]">
        Attach a domain and point its DNS at this server. Let&apos;s Encrypt needs the host to
        answer on ports 80/443 — for local/no-ingress setups choose certificate &ldquo;None&rdquo;
        and untick HTTPS.
      </p>

      {app.domains.length > 0 ? (
        <div className="space-y-2">
          {app.domains.map((d) => (
            <DomainRow key={d.domainId} d={d} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--color-fg-subtle)]">No domains attached.</p>
      )}

      <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
        <div className="text-xs font-medium text-[var(--color-fg-muted)]">Add a domain</div>
        <DomainFields value={draft} onChange={(patch) => setDraft((v) => ({ ...v, ...patch }))} />
        <div className="flex items-center justify-end">
          <button
            onClick={add}
            disabled={pending || !draft.host.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

export function DeploymentsTab({ app }: { app: Application }) {
  const deployments = [...app.deployments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const color = (s: string) =>
    s === "done" ? "var(--color-ok)" : s === "error" ? "var(--color-danger)" : s === "running" ? "var(--color-warn)" : "var(--color-idle)";
  return (
    <div className="space-y-2">
      <p className="mb-1 text-xs text-[var(--color-fg-muted)]">Deployment history (newest first).</p>
      {deployments.length === 0 ? (
        <p className="text-xs text-[var(--color-fg-subtle)]">No deployments yet.</p>
      ) : (
        deployments.map((d) => (
          <div
            key={d.deploymentId}
            className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color(d.status) }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{d.title}</div>
              <div className="text-[11px] text-[var(--color-fg-subtle)]">
                {d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}
              </div>
            </div>
            <span className="text-xs capitalize text-[var(--color-fg-muted)]">{d.status}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function AppSettingsTab({ app, onClose }: { app: Application; onClose: () => void }) {
  const { pending: lifePending, error: lifeError, run } = useAppLifecycle(app);
  const [name, setName] = useState(app.name);
  const [cpu, setCpu] = useState(app.cpuLimit ?? "");
  const [mem, setMem] = useState(app.memoryLimit ?? "");
  const [saving, startSave] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = name !== app.name || cpu !== (app.cpuLimit ?? "") || mem !== (app.memoryLimit ?? "");

  function save() {
    setSaveError(null);
    startSave(async () => {
      const res = await updateApplicationAction(
        app.id,
        {
          name: name.trim(),
          cpuLimit: cpu || null,
          memoryLimit: mem || null,
        },
        cpu !== (app.cpuLimit ?? "") || mem !== (app.memoryLimit ?? "")
      );
      if (res.ok) flashSaved();
      else setSaveError(res.error);
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPU limit">
            <input value={cpu} onChange={(e) => setCpu(e.target.value)} placeholder="unlimited" className={inputCls} />
          </Field>
          <Field label="Memory limit">
            <input value={mem} onChange={(e) => setMem(e.target.value)} placeholder="unlimited" className={inputCls} />
          </Field>
        </div>
        <SaveRow saving={saving} saved={saved} error={saveError} disabled={!dirty} onSave={save} />
      </div>

      <Info label="App name" value={app.appName} mono />

      <DangerZone
        name={app.name}
        message="Destroying removes the application and its container."
        pending={lifePending}
        error={lifeError}
        onDestroy={() => run("remove", onClose)}
      />
    </div>
  );
}
