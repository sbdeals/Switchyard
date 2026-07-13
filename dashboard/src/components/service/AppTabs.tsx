"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  Globe,
  ExternalLink,
  Plus,
  Loader2,
  Play,
  Trash2,
  Pencil,
  Power,
  Clock,
} from "lucide-react";
import type { Application, Schedule } from "@/lib/dokploy";
import {
  appLifecycleAction,
  updateApplicationAction,
  createDomainAction,
  listSchedulesAction,
  createScheduleAction,
  updateScheduleAction,
  deleteScheduleAction,
  runScheduleAction,
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
import { cn } from "@/lib/utils";

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

// --- schedules --------------------------------------------------------------

export function SchedulesTab({ app }: { app: Application }) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();

  const reload = useCallback(() => {
    startLoad(async () => {
      const res = await listSchedulesAction(app.id);
      if (res.ok) {
        setSchedules(res.schedules);
        setLoadError(null);
      } else {
        setLoadError(res.error);
      }
    });
  }, [app.id]);

  useEffect(() => reload(), [reload]);

  return (
    <div className="space-y-5">
      <p className="text-xs text-[var(--color-fg-muted)]">
        Cron jobs run a command inside this app&apos;s container on a schedule (times are UTC). The
        container must be running when the job fires.
      </p>

      <CreateScheduleForm applicationId={app.id} onCreated={reload} />

      <div className="space-y-2">
        {schedules === null ? (
          <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
            <Loader2 className="size-4 animate-spin" /> loading schedules…
          </div>
        ) : loadError ? (
          <p className="text-xs text-[var(--color-danger)]">{loadError}</p>
        ) : schedules.length === 0 ? (
          <p className="text-xs text-[var(--color-fg-subtle)]">No schedules yet.</p>
        ) : (
          schedules.map((s) => <ScheduleRow key={s.scheduleId} schedule={s} onChanged={reload} />)
        )}
      </div>
      {loading && schedules !== null && (
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-fg-subtle)]">
          <Loader2 className="size-3 animate-spin" /> refreshing…
        </div>
      )}
    </div>
  );
}

const CRON_PLACEHOLDER = "0 3 * * *";

function CreateScheduleForm({
  applicationId,
  onCreated,
}: {
  applicationId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [command, setCommand] = useState("");
  const [shell, setShell] = useState<"bash" | "sh">("bash");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim() && cron.trim() && command.trim();

  function create() {
    if (!valid) return;
    setError(null);
    start(async () => {
      const res = await createScheduleAction({
        applicationId,
        name: name.trim(),
        cronExpression: cron.trim(),
        command: command.trim(),
        shellType: shell,
      });
      if (res.ok) {
        setName("");
        setCron("");
        setCommand("");
        setShell("bash");
        onCreated();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-fg-muted)]">
        <Plus className="size-3.5" /> New schedule
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="nightly-backup"
            className={inputCls}
          />
        </Field>
        <Field label="Cron expression" hint="min hour dom mon dow">
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder={CRON_PLACEHOLDER}
            className={cn(inputCls, "font-mono")}
          />
        </Field>
      </div>
      <Field label="Command">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="node scripts/cleanup.js"
          className={cn(inputCls, "font-mono")}
        />
      </Field>
      <div className="flex items-end justify-between gap-3">
        <div className="w-28">
          <Field label="Shell">
            <select
              value={shell}
              onChange={(e) => setShell(e.target.value as "bash" | "sh")}
              className={inputCls}
            >
              <option value="bash">bash</option>
              <option value="sh">sh</option>
            </select>
          </Field>
        </div>
        <button
          onClick={create}
          disabled={pending || !valid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create
        </button>
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function ScheduleRow({ schedule, onChanged }: { schedule: Schedule; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Draft fields, initialized from the schedule; reset when the row collapses.
  const [name, setName] = useState(schedule.name);
  const [cron, setCron] = useState(schedule.cronExpression);
  const [command, setCommand] = useState(schedule.command);
  const [shell, setShell] = useState(schedule.shellType);

  function openEdit() {
    setName(schedule.name);
    setCron(schedule.cronExpression);
    setCommand(schedule.command);
    setShell(schedule.shellType);
    setError(null);
    setEditing(true);
  }

  // update reuses Dokploy's create schema, so every field is resent each time.
  function runUpdate(patch: { enabled?: boolean }, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await updateScheduleAction(schedule.scheduleId, {
        name: name.trim() || schedule.name,
        cronExpression: cron.trim() || schedule.cronExpression,
        command: command.trim() || schedule.command,
        shellType: shell,
        enabled: patch.enabled ?? schedule.enabled,
      });
      if (res.ok) after?.();
      else setError(res.error);
    });
  }

  function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) onChanged();
      else setError(res.error);
    });
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <Clock
          className={cn(
            "size-3.5 shrink-0",
            schedule.enabled ? "text-[var(--color-brand)]" : "text-[var(--color-idle)]"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm">{schedule.name}</span>
            <code className="shrink-0 rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]">
              {schedule.cronExpression}
            </code>
            {!schedule.enabled && (
              <span className="shrink-0 text-[10px] text-[var(--color-fg-subtle)]">disabled</span>
            )}
          </div>
          <code className="mt-0.5 block truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">
            {schedule.shellType} -c {schedule.command}
          </code>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconBtn title="Run now" onClick={() => act(() => runScheduleAction(schedule.scheduleId))} disabled={busy}>
            <Play className="size-3.5" />
          </IconBtn>
          <IconBtn
            title={schedule.enabled ? "Disable" : "Enable"}
            onClick={() => runUpdate({ enabled: !schedule.enabled }, onChanged)}
            disabled={busy}
          >
            <Power className={cn("size-3.5", schedule.enabled && "text-[var(--color-ok)]")} />
          </IconBtn>
          <IconBtn title="Edit" onClick={() => (editing ? setEditing(false) : openEdit())} disabled={busy}>
            <Pencil className="size-3.5" />
          </IconBtn>
          <IconBtn
            title="Delete"
            onClick={() => {
              if (confirm(`Delete schedule "${schedule.name}"?`))
                act(() => deleteScheduleAction(schedule.scheduleId));
            }}
            disabled={busy}
          >
            <Trash2 className="size-3.5 text-[var(--color-danger)]" />
          </IconBtn>
        </div>
      </div>

      {editing && (
        <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Cron expression">
              <input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                className={cn(inputCls, "font-mono")}
              />
            </Field>
          </div>
          <Field label="Command">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className={cn(inputCls, "font-mono")}
            />
          </Field>
          <div className="flex items-end justify-between gap-3">
            <div className="w-28">
              <Field label="Shell">
                <select
                  value={shell}
                  onChange={(e) => setShell(e.target.value as "bash" | "sh")}
                  className={inputCls}
                >
                  <option value="bash">bash</option>
                  <option value="sh">sh</option>
                </select>
              </Field>
            </div>
            <SaveRow
              saving={busy}
              saved={false}
              error={null}
              disabled={!name.trim() || !cron.trim() || !command.trim()}
              onSave={() => runUpdate({}, () => {
                setEditing(false);
                onChanged();
              })}
            />
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
