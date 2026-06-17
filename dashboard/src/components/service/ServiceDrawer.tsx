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
} from "lucide-react";
import type { Database } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
import { connectionString } from "@/lib/connection";
import { lifecycleAction } from "@/app/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { VariablesTab } from "@/components/service/VariablesTab";
import { MetricsTab } from "@/components/service/MetricsTab";
import { LogsTab } from "@/components/service/LogsTab";
import { cn } from "@/lib/utils";

type TabId = "overview" | "variables" | "metrics" | "logs" | "settings";
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <SlidersHorizontal className="size-4" /> },
  { id: "variables", label: "Variables", icon: <KeyRound className="size-4" /> },
  { id: "metrics", label: "Metrics", icon: <Cpu className="size-4" /> },
  { id: "logs", label: "Logs", icon: <ScrollText className="size-4" /> },
  { id: "settings", label: "Settings", icon: <Settings2 className="size-4" /> },
];

export function ServiceDrawer({ db, onClose }: { db: Database | null; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("overview");
  // Reset to Overview when a different service is opened (adjust state during
  // render — the React-recommended alternative to a resetting effect).
  const [shownId, setShownId] = useState<string | null>(null);
  if (db && db.id !== shownId) {
    setShownId(db.id);
    setTab("overview");
  }

  return (
    <AnimatePresence>
      {db && (
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
            <Header db={db} onClose={onClose} />
            <nav className="flex gap-1 border-b border-[var(--color-border)] px-4">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
                    tab === t.id
                      ? "border-[var(--color-brand)] text-[var(--color-fg)]"
                      : "border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-auto p-5">
              {tab === "overview" && <OverviewTab db={db} />}
              {tab === "variables" && <VariablesTab db={db} />}
              {tab === "metrics" && <MetricsTab key={db.appName} appName={db.appName} active />}
              {tab === "logs" && <LogsTab key={db.appName} appName={db.appName} active />}
              {tab === "settings" && <SettingsTab db={db} onClose={onClose} />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Header({ db, onClose }: { db: Database; onClose: () => void }) {
  const meta = ENGINE_META[db.engine];
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
      <div className="flex items-center gap-3">
        <div
          className="flex size-11 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${meta.accent}1a`, color: meta.accent }}
        >
          <DatabaseIcon className="size-5.5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{db.name}</h2>
            <StatusBadge status={db.status} />
          </div>
          <div className="text-xs text-[var(--color-fg-muted)]">
            {meta.label} · {db.projectName} / {db.environmentName}
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
              ? `${db.cpuLimit ?? "∞"} CPU · ${db.memoryLimit ? `${Math.round(db.memoryLimit / 1024 / 1024)}MB` : "∞"}`
              : "unlimited"
          }
        />
      </div>
    </div>
  );
}

function SettingsTab({ db, onClose }: { db: Database; onClose: () => void }) {
  const { pending, error, run } = useLifecycle(db);
  return (
    <div className="space-y-5">
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
          disabled={pending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-danger)]/50 px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-50"
        >
          <Trash2 className="size-3.5" /> Destroy {db.name}
        </button>
        {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
      </div>
    </div>
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
