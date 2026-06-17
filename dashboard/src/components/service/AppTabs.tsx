"use client";

import { useState, useTransition } from "react";
import {
  Rocket,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Globe,
  ExternalLink,
  Plus,
  Loader2,
} from "lucide-react";
import type { Application } from "@/lib/dokploy";
import {
  appLifecycleAction,
  updateApplicationAction,
  createDomainAction,
} from "@/app/actions";

const inputCls =
  "w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)]";

function useAppLifecycle(app: Application) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: "deploy" | "start" | "stop" | "remove", after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await appLifecycleAction(app.id, action);
      if (!res.ok) setError(res.error);
      else after?.();
    });
  };
  return { pending, error, run };
}

export function AppOverviewTab({ app }: { app: Application }) {
  const { pending, error, run } = useAppLifecycle(app);
  const running = app.status === "done";
  const primary = app.domains[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {app.status === "idle" ? (
          <Btn onClick={() => run("deploy")} disabled={pending} primary>
            <Rocket className="size-3.5" /> Deploy
          </Btn>
        ) : running ? (
          <Btn onClick={() => run("stop")} disabled={pending}>
            <Square className="size-3.5" /> Stop
          </Btn>
        ) : (
          <Btn onClick={() => run("start")} disabled={pending}>
            <Play className="size-3.5" /> Start
          </Btn>
        )}
        {app.status !== "idle" && (
          <Btn onClick={() => run("deploy")} disabled={pending}>
            <RefreshCw className="size-3.5" /> Redeploy
          </Btn>
        )}
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

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
        <Info label="Image" value={app.dockerImage ?? "—"} mono />
        <Info label="Build" value={app.buildType ?? "—"} />
        <Info label="Replicas" value={String(app.replicas ?? 1)} />
      </div>
    </div>
  );
}

export function DomainsTab({ app }: { app: Application }) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("80");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (!host.trim()) return;
    setError(null);
    start(async () => {
      const res = await createDomainAction(app.id, host, Number(port) || 80);
      if (res.ok) setHost("");
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-fg-muted)]">
        Attach a domain (auto-SSL via Let&apos;s Encrypt). Point the domain&apos;s DNS at this
        server for it to resolve.
      </p>

      {app.domains.length > 0 ? (
        <div className="space-y-2">
          {app.domains.map((d) => (
            <a
              key={d.domainId}
              href={`${d.https ? "https" : "http"}://${d.host}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)]"
            >
              <Globe className="size-3.5 text-[var(--color-brand)]" />
              <span className="flex-1 truncate">{d.host}</span>
              {d.port && <span className="text-xs text-[var(--color-fg-subtle)]">:{d.port}</span>}
              <ExternalLink className="size-3 text-[var(--color-fg-subtle)]" />
            </a>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--color-fg-subtle)]">No domains attached.</p>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <div className="mb-1.5 text-xs font-medium text-[var(--color-fg-muted)]">Host</div>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="app.example.com"
            className={inputCls}
          />
        </div>
        <div className="w-20">
          <div className="mb-1.5 text-xs font-medium text-[var(--color-fg-muted)]">Port</div>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
            className={inputCls}
          />
        </div>
        <button
          onClick={add}
          disabled={pending || !host.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </button>
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

export function AppSettingsTab({ app, onClose }: { app: Application; onClose: () => void }) {
  const { pending: lifePending, error: lifeError, run } = useAppLifecycle(app);
  const [name, setName] = useState(app.name);
  const [cpu, setCpu] = useState(app.cpuLimit ?? "");
  const [mem, setMem] = useState(app.memoryLimit ?? "");
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = name !== app.name || cpu !== (app.cpuLimit ?? "") || mem !== (app.memoryLimit ?? "");

  function save() {
    setSaveError(null);
    setSaved(false);
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
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } else setSaveError(res.error);
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
        <div className="flex items-center justify-end gap-2">
          {saveError && <span className="text-xs text-[var(--color-danger)]">{saveError}</span>}
          {saved && <span className="text-xs text-[var(--color-ok)]">Saved</span>}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </button>
        </div>
      </div>

      <Info label="App name" value={app.appName} mono />

      <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] p-4">
        <h3 className="text-sm font-semibold text-[var(--color-danger)]">Danger zone</h3>
        <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
          Destroying removes the application and its container. This cannot be undone.
        </p>
        <button
          onClick={() => {
            if (confirm(`Destroy "${app.name}"? This cannot be undone.`)) run("remove", onClose);
          }}
          disabled={lifePending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-danger)]/50 px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-50"
        >
          <Trash2 className="size-3.5" /> Destroy {app.name}
        </button>
        {lifeError && <p className="mt-2 text-xs text-[var(--color-danger)]">{lifeError}</p>}
      </div>
    </div>
  );
}

// --- shared primitives ------------------------------------------------------

function Btn({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 " +
        (primary
          ? "bg-[var(--color-brand-strong)] text-white hover:bg-[var(--color-brand)]"
          : "border border-[var(--color-border-strong)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]")
      }
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-[var(--color-fg-muted)]">{label}</div>
      {children}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-xs text-[var(--color-fg-subtle)]">{label}</div>
      <div className={"mt-0.5 truncate text-sm " + (mono ? "font-mono text-xs" : "")} title={value}>
        {value}
      </div>
    </div>
  );
}
