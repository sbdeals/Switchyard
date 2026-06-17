"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import {
  Database as DatabaseIcon,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Rocket,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import type { Database } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
import { lifecycleAction } from "@/app/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

function connectionString(db: Database): string | null {
  const meta = ENGINE_META[db.engine];
  const host = db.appName || db.name;
  const port = db.externalPort ?? meta.defaultPort;
  const user = db.databaseUser ?? "";
  const pass = db.databasePassword ?? "";
  const name = db.databaseName ?? "";
  switch (db.engine) {
    case "postgres":
      return `postgresql://${user}:${pass}@${host}:${port}/${name}`;
    case "mysql":
    case "mariadb":
      return `mysql://${user}:${pass}@${host}:${port}/${name}`;
    case "mongo":
      return `mongodb://${user}:${pass}@${host}:${port}`;
    case "redis":
      return `redis://default:${pass}@${host}:${port}`;
    default:
      return null;
  }
}

export function DatabaseCard({ db, onOpen }: { db: Database; onOpen?: () => void }) {
  const meta = ENGINE_META[db.engine];
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = (action: "deploy" | "start" | "stop" | "remove") => {
    if (action === "remove" && !confirm(`Destroy "${db.name}"? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await lifecycleAction(db.engine, db.id, action);
      if (!res.ok) setError(res.error);
    });
  };

  const conn = connectionString(db);
  const isRunning = db.status === "done";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="group relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${meta.accent}, transparent)` }}
      />
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={onOpen}
          className="flex flex-1 items-center gap-3 text-left"
          title="Open service"
        >
          <div
            className="flex size-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${meta.accent}1a`, color: meta.accent }}
          >
            <DatabaseIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium leading-tight hover:text-[var(--color-brand)]">
              {db.name}
            </div>
            <div className="truncate text-xs text-[var(--color-fg-muted)]">
              {meta.label}
              {db.dockerImage ? ` · ${db.dockerImage}` : ""}
            </div>
          </div>
        </button>
        <StatusBadge status={db.status} />
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
        <span className="rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5">
          {db.projectName}
        </span>
        <span>/</span>
        <span className="rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5">
          {db.environmentName}
        </span>
      </div>

      {conn && (
        <div className="mt-4">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            <span>Connection</span>
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2">
              <code className="flex-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
                {conn}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(conn);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
                className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                title="Copy"
              >
                {copied ? (
                  <Check className="size-3.5 text-[var(--color-ok)]" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {db.status === "idle" ? (
          <ActionButton onClick={() => run("deploy")} pending={pending} primary>
            <Rocket className="size-3.5" /> Deploy
          </ActionButton>
        ) : isRunning ? (
          <ActionButton onClick={() => run("stop")} pending={pending}>
            <Square className="size-3.5" /> Stop
          </ActionButton>
        ) : (
          <ActionButton onClick={() => run("start")} pending={pending}>
            <Play className="size-3.5" /> Start
          </ActionButton>
        )}
        {db.status !== "idle" && (
          <ActionButton onClick={() => run("deploy")} pending={pending}>
            <RefreshCw className="size-3.5" /> Redeploy
          </ActionButton>
        )}
        <ActionButton onClick={() => run("remove")} pending={pending} danger>
          <Trash2 className="size-3.5" /> Destroy
        </ActionButton>
      </div>

      {error && <p className="mt-3 text-xs text-[var(--color-danger)]">{error}</p>}
    </motion.div>
  );
}

function ActionButton({
  children,
  onClick,
  pending,
  primary,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pending: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
        primary &&
          "bg-[var(--color-brand-strong)] text-white hover:bg-[var(--color-brand)]",
        danger &&
          "text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]",
        !primary &&
          !danger &&
          "border border-[var(--color-border-strong)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
      )}
    >
      {children}
    </button>
  );
}
