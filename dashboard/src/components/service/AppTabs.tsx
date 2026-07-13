"use client";

import { useState, useTransition } from "react";
import {
  Globe,
  ExternalLink,
  Plus,
  Loader2,
  GitBranch,
  Webhook,
  RotateCcw,
} from "lucide-react";
import type { Application } from "@/lib/dokploy";
import {
  appLifecycleAction,
  updateApplicationAction,
  createDomainAction,
  updateGitDeployAction,
  rollbackDeploymentAction,
} from "@/app/actions";
import {
  inputCls,
  Field,
  Info,
  CopyButton,
  LifecycleButtons,
  SaveRow,
  DangerZone,
  useLifecycle,
  useSavedFlash,
} from "@/components/service/primitives";

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
          <Field label="Host">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="app.example.com"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="w-20">
          <Field label="Port">
            <input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputCls}
            />
          </Field>
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

export function DeploymentsTab({ app }: { app: Application }) {
  return (
    <div className="space-y-6">
      {app.sourceType === "git" && <AutoDeployPanel app={app} />}
      <DeploymentHistory app={app} />
    </div>
  );
}

/**
 * Push-to-deploy config for a custom-git app: the copyable Dokploy deploy
 * webhook to wire into a Git host, plus branch / watch-paths / auto-deploy.
 */
function AutoDeployPanel({ app }: { app: Application }) {
  const [branch, setBranch] = useState(app.branch ?? "main");
  const [autoDeploy, setAutoDeploy] = useState(app.autoDeploy);
  const [watch, setWatch] = useState(app.watchPaths.join("\n"));
  const [saving, start] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);

  const watchList = watch.split("\n").map((s) => s.trim()).filter(Boolean);
  const dirty =
    branch !== (app.branch ?? "main") ||
    autoDeploy !== app.autoDeploy ||
    watchList.join("\n") !== app.watchPaths.join("\n");

  function save() {
    setError(null);
    start(async () => {
      const res = await updateGitDeployAction(app.id, {
        gitUrl: app.gitUrl,
        branch,
        buildPath: app.buildPath ?? "/",
        watchPaths: watchList,
        autoDeploy,
      });
      if (res.ok) flashSaved();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-2">
        <Webhook className="size-4 text-[var(--color-brand)]" />
        <h3 className="text-sm font-semibold">Push to deploy</h3>
      </div>

      <Field label="Deploy webhook URL" hint="add to your Git host">
        {app.webhookUrl ? (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2.5">
            <code className="flex-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
              {app.webhookUrl}
            </code>
            <CopyButton text={app.webhookUrl} />
          </div>
        ) : (
          <p className="text-xs text-[var(--color-fg-subtle)]">
            No webhook token yet — deploy the app once to generate one.
          </p>
        )}
      </Field>
      <p className="text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
        Add this as a push webhook in your Git host (GitHub: Settings → Webhooks,
        content type <span className="font-mono">application/json</span>). If Dokploy
        is reachable at a public domain, replace the host with that address. A push
        to <span className="font-mono">{branch || "main"}</span> then redeploys this
        app while auto-deploy is on.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Branch">
          <div className="relative">
            <GitBranch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className={`${inputCls} pl-8`}
            />
          </div>
        </Field>
        <Field label="Auto-deploy" hint="webhook on/off">
          <button
            type="button"
            role="switch"
            aria-checked={autoDeploy}
            onClick={() => setAutoDeploy((v) => !v)}
            className={`inline-flex h-9 w-full items-center justify-between rounded-lg border px-3 text-xs font-medium transition-colors ${
              autoDeploy
                ? "border-[var(--color-brand)] text-[var(--color-fg)]"
                : "border-[var(--color-border-strong)] text-[var(--color-fg-muted)]"
            }`}
          >
            {autoDeploy ? "Enabled" : "Disabled"}
            <span
              className={`relative h-4 w-7 rounded-full transition-colors ${
                autoDeploy ? "bg-[var(--color-brand-strong)]" : "bg-[var(--color-idle)]"
              }`}
            >
              <span
                className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${
                  autoDeploy ? "left-3.5" : "left-0.5"
                }`}
              />
            </span>
          </button>
        </Field>
      </div>

      <Field label="Watch paths" hint="one per line · blank = any change">
        <textarea
          value={watch}
          onChange={(e) => setWatch(e.target.value)}
          placeholder="src/&#10;package.json"
          rows={2}
          className={`${inputCls} resize-y font-mono`}
        />
      </Field>

      <SaveRow saving={saving} saved={saved} error={error} disabled={!dirty} onSave={save} />
    </div>
  );
}

function DeploymentHistory({ app }: { app: Application }) {
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
            {d.rollbackId ? (
              <RollbackButton rollbackId={d.rollbackId} title={d.title} />
            ) : (
              <span className="text-xs capitalize text-[var(--color-fg-muted)]">{d.status}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** Restore a past deployment's image snapshot (Dokploy image-based rollback). */
function RollbackButton({ rollbackId, title }: { rollbackId: string; title: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function rollback() {
    if (!confirm(`Roll back to "${title}"? This redeploys the recorded image.`)) return;
    setError(null);
    start(async () => {
      const res = await rollbackDeploymentAction(rollbackId);
      if (!res.ok) setError(res.error);
    });
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={rollback}
        disabled={pending}
        title="Roll back to this deployment"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] disabled:opacity-40"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        Roll back
      </button>
      {error && <span className="text-[11px] text-[var(--color-danger)]">{error}</span>}
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
