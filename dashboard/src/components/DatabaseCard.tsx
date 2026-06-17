"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { Database as DatabaseIcon, Rocket, ChevronRight } from "lucide-react";
import type { Database } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
import { lifecycleAction } from "@/app/actions";
import { StatusBadge } from "@/components/StatusBadge";

/**
 * Compact card: identity + status at a glance, click to open the drawer where
 * all config, lifecycle, logs and metrics live. Only a one-click Deploy shows
 * inline when the database hasn't been deployed yet.
 */
export function DatabaseCard({ db, onOpen }: { db: Database; onOpen?: () => void }) {
  const meta = ENGINE_META[db.engine];
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const deploy = (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    startTransition(async () => {
      const res = await lifecycleAction(db.engine, db.id, "deploy");
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      onClick={onOpen}
      className="group relative cursor-pointer overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${meta.accent}, transparent)` }}
      />
      <div className="flex items-center gap-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${meta.accent}1a`, color: meta.accent }}
        >
          <DatabaseIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium leading-tight">{db.name}</div>
          <div className="truncate text-xs text-[var(--color-fg-muted)]">
            {meta.label}
            {db.dockerImage ? ` · ${db.dockerImage}` : ""}
          </div>
        </div>
        <StatusBadge status={db.status} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="truncate text-xs text-[var(--color-fg-subtle)]">
          {db.projectName} / {db.environmentName}
        </span>
        {db.status === "idle" ? (
          <button
            onClick={deploy}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
          >
            <Rocket className="size-3.5" /> Deploy
          </button>
        ) : (
          <ChevronRight className="size-4 text-[var(--color-fg-subtle)] transition-transform group-hover:translate-x-0.5" />
        )}
      </div>

      {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
    </motion.div>
  );
}
