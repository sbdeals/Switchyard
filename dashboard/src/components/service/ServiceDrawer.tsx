"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Database as DatabaseIcon,
  Rocket,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  Cpu,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  KeyRound,
  Loader2,
  Eye,
  EyeOff,
  Box,
  Globe,
  Layers,
  FileCode,
} from "lucide-react";
import type { Database, DatabasePatch, Service } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
import { serviceAccent, serviceLabel } from "@/lib/service-meta";
import { connectionString } from "@/lib/connection";
import { lifecycleAction, updateDatabaseAction } from "@/app/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { VariablesTab } from "@/components/service/VariablesTab";
import { MetricsTab } from "@/components/service/MetricsTab";
import { LogsTab } from "@/components/service/LogsTab";
import {
  AppOverviewTab,
  AppSettingsTab,
  DomainsTab,
  DeploymentsTab,
} from "@/components/service/AppTabs";
import {
  ComposeOverviewTab,
  ComposeEditorTab,
  ComposeSettingsTab,
} from "@/components/service/ComposeTabs";
import { cn } from "@/lib/utils";

type TabId =
  | "overview"
  | "variables"
  | "domains"
  | "deployments"
  | "editor"
  | "metrics"
  | "logs"
  | "settings";
const TAB_META: Record<TabId, { label: string; icon: React.ReactNode }> = {
  overview: { label: "Overview", icon: <SlidersHorizontal className="size-4" /> },
  variables: { label: "Variables", icon: <KeyRound className="size-4" /> },
  domains: { label: "Domains", icon: <Globe className="size-4" /> },
  deployments: { label: "Deploys", icon: <Rocket className="size-4" /> },
  editor: { label: "Compose", icon: <FileCode className="size-4" /> },
  metrics: { label: "Metrics", icon: <Cpu className="size-4" /> },
  logs: { label: "Logs", icon: <ScrollText className="size-4" /> },
  settings: { label: "Settings", icon: <Settings2 className="size-4" /> },
};
const DB_TABS: TabId[] = ["overview", "variables", "metrics", "logs", "settings"];
const APP_TABS: TabId[] = [
  "overview",
  "variables",
  "domains",
  "deployments",
  "metrics",
  "logs",
  "settings",
];
const COMPOSE_TABS: TabId[] = ["overview", "editor", "logs", "settings"];

export function ServiceDrawer({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("overview");
  // Reset to Overview when a different service is opened (adjust state during
  // render — the React-recommended alternative to a resetting effect).
  const [shownId, setShownId] = useState<string | null>(null);
  if (service && service.id !== shownId) {
    setShownId(service.id);
    setTab("overview");
  }
  const tabs =
    service?.kind === "application"
      ? APP_TABS
      : service?.kind === "compose"
        ? COMPOSE_TABS
        : DB_TABS;

  return (
    <AnimatePresence>
      {service && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl"
          >
            <Header service={service} onClose={onClose} />
            <nav className="flex gap-1 border-b border-[var(--color-border)] px-4">
              {tabs.map((id) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
                    tab === id
                      ? "border-[var(--color-brand)] text-[var(--color-fg)]"
                      : "border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                  )}
                >
                  {TAB_META[id].icon}
                  {TAB_META[id].label}
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-auto p-5">
              {tab === "overview" &&
                (service.kind === "database" ? (
                  <OverviewTab db={service} />
                ) : service.kind === "compose" ? (
                  <ComposeOverviewTab compose={service} />
                ) : (
                  <AppOverviewTab app={service} />
                ))}
              {tab === "variables" && service.kind !== "compose" && (
                <VariablesTab service={service} />
              )}
              {tab === "domains" && service.kind === "application" && <DomainsTab app={service} />}
              {tab === "deployments" && service.kind === "application" && (
                <DeploymentsTab app={service} />
              )}
              {tab === "editor" && service.kind === "compose" && (
                <ComposeEditorTab compose={service} />
              )}
              {tab === "metrics" && <MetricsTab key={service.appName} appName={service.appName} active />}
              {tab === "logs" && <LogsTab key={service.appName} appName={service.appName} active />}
              {tab === "settings" &&
                (service.kind === "database" ? (
                  <SettingsTab db={service} onClose={onClose} />
                ) : service.kind === "compose" ? (
                  <ComposeSettingsTab compose={service} onClose={onClose} />
                ) : (
                  <AppSettingsTab app={service} onClose={onClose} />
                ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Header({ service, onClose }: { service: Service; onClose: () => void }) {
  const accent = serviceAccent(service);
  const Icon = service.kind === "database" ? DatabaseIcon : service.kind === "compose" ? Layers : Box;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
      <div className="flex items-center gap-3">
        <div
          className="flex size-11 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}1a`, color: accent }}
        >
          <Icon className="size-5.5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{service.name}</h2>
            <StatusBadge status={service.status} />
          </div>
          <div className="text-xs text-[var(--color-fg-muted)]">
            {serviceLabel(service)} · {service.projectName} / {service.environmentName}
          </div>
        </div>
      </div>
      <button
        onClick={onClose}
        className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function useLifecycle(db: Database) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: "deploy" | "start" | "stop" | "remove", after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await lifecycleAction(db.engine, db.id, action);
      if (!res.ok) setError(res.error);
      else after?.();
    });
  };
  return { pending, error, run };
}

function OverviewTab({ db }: { db: Database }) {
  const meta = ENGINE_META[db.engine];
  const { pending, error, run } = useLifecycle(db);
  const conn = connectionString(db);
  const [copied, setCopied] = useState(false);
  const running = db.status === "done";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {db.status === "idle" ? (
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
        {db.status !== "idle" && (
          <Btn onClick={() => run("deploy")} disabled={pending}>
            <RefreshCw className="size-3.5" /> Redeploy
          </Btn>
        )}
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

      {conn && (
        <Field label="Connection string">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2.5">
            <code className="flex-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
              {conn}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(conn);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            >
              {copied ? <Check className="size-3.5 text-[var(--color-ok)]" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Info label="Image" value={db.dockerImage ?? "—"} mono />
        <Info label="Internal port" value={String(db.externalPort ?? meta.defaultPort)} />
        <Info label="Replicas" value={String(db.replicas ?? 1)} />
        <Info label="Database" value={db.databaseName ?? "—"} mono />
        <Info label="User" value={db.databaseUser ?? "—"} mono />
        <Info
          label="Resources"
          value={
            db.cpuLimit || db.memoryLimit
              ? `${db.cpuLimit ?? "∞"} CPU · ${db.memoryLimit ?? "∞"} mem`
              : "unlimited"
          }
        />
      </div>
    </div>
  );
}

function SettingsTab({ db, onClose }: { db: Database; onClose: () => void }) {
  const { pending: lifePending, error: lifeError, run } = useLifecycle(db);
  const meta = ENGINE_META[db.engine];
  const currentVersion = db.dockerImage?.split(":")[1] ?? meta.versions[0];

  const [name, setName] = useState(db.name);
  const [version, setVersion] = useState(currentVersion);
  const [port, setPort] = useState(db.externalPort != null ? String(db.externalPort) : "");
  const [cpu, setCpu] = useState(db.cpuLimit ?? "");
  const [mem, setMem] = useState(db.memoryLimit ?? "");
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty =
    name !== db.name ||
    version !== currentVersion ||
    port !== (db.externalPort != null ? String(db.externalPort) : "") ||
    cpu !== (db.cpuLimit ?? "") ||
    mem !== (db.memoryLimit ?? "");

  function save() {
    setSaveError(null);
    setSaved(false);
    const patch: DatabasePatch = {};
    if (name !== db.name) patch.name = name.trim();
    if (version !== currentVersion) patch.dockerImage = `${meta.image}:${version}`;
    if (port !== (db.externalPort != null ? String(db.externalPort) : ""))
      patch.externalPort = port ? Number(port) : null;
    if (cpu !== (db.cpuLimit ?? "")) patch.cpuLimit = cpu || null;
    if (mem !== (db.memoryLimit ?? "")) patch.memoryLimit = mem || null;
    startSave(async () => {
      const res = await updateDatabaseAction(db.engine, db.id, db.appName, patch);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } else setSaveError(res.error);
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <EditField label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </EditField>
        <div className="grid grid-cols-2 gap-3">
          <EditField label="Version" hint="changing redeploys">
            <select value={version} onChange={(e) => setVersion(e.target.value)} className={inputCls}>
              {meta.versions.map((v) => (
                <option key={v} value={v}>
                  {meta.image}:{v}
                </option>
              ))}
            </select>
          </EditField>
          <EditField label="External port" hint="blank = internal only">
            <input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="—"
              className={inputCls}
            />
          </EditField>
          <EditField label="CPU limit" hint='e.g. "0.5"'>
            <input value={cpu} onChange={(e) => setCpu(e.target.value)} placeholder="unlimited" className={inputCls} />
          </EditField>
          <EditField label="Memory limit" hint='e.g. "256m"'>
            <input value={mem} onChange={(e) => setMem(e.target.value)} placeholder="unlimited" className={inputCls} />
          </EditField>
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

      <PasswordRow db={db} />

      <Info label="App name" value={db.appName} mono />
      <Info label="Created" value={db.createdAt ? new Date(db.createdAt).toLocaleString() : "—"} />

      <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] p-4">
        <h3 className="text-sm font-semibold text-[var(--color-danger)]">Danger zone</h3>
        <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
          Destroying removes the service and its container. This cannot be undone.
        </p>
        <button
          onClick={() => {
            if (confirm(`Destroy "${db.name}"? This cannot be undone.`))
              run("remove", onClose);
          }}
          disabled={lifePending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-danger)]/50 px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-50"
        >
          <Trash2 className="size-3.5" /> Destroy {db.name}
        </button>
        {lifeError && <p className="mt-2 text-xs text-[var(--color-danger)]">{lifeError}</p>}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)]";

function EditField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium text-[var(--color-fg-muted)]">{label}</span>
        {hint && <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function PasswordRow({ db }: { db: Database }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!db.databasePassword) return null;
  return (
    <EditField label="Password" hint="rotation coming soon">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2">
        <code className="flex-1 truncate font-mono text-xs text-[var(--color-fg-muted)]">
          {show ? db.databasePassword : "•".repeat(16)}
        </code>
        <button
          onClick={() => setShow((s) => !s)}
          className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(db.databasePassword ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          {copied ? <Check className="size-3.5 text-[var(--color-ok)]" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </EditField>
  );
}

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
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40",
        primary
          ? "bg-[var(--color-brand-strong)] text-white hover:bg-[var(--color-brand)]"
          : "border border-[var(--color-border-strong)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
      )}
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
      <div className={cn("mt-0.5 truncate text-sm", mono && "font-mono text-xs")} title={value}>
        {value}
      </div>
    </div>
  );
}
