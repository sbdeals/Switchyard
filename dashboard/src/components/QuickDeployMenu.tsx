"use client";

import { useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Database as DatabaseIcon, Loader2, AlertCircle } from "lucide-react";
import type { Engine, ProjectNode } from "@/lib/dokploy";
import { ENGINE_LIST } from "@/lib/engines";
import { quickDeployDatabaseAction } from "@/app/actions";

/**
 * One-click database provisioning: pick an engine and it deploys immediately
 * with an auto name, password, and latest version. Everything is editable
 * afterward in the service drawer.
 */
export function QuickDeployMenu({
  projects,
  onDeployed,
}: {
  projects: ProjectNode[];
  onDeployed: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingEngine, setPendingEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const envOptions = useMemo(
    () =>
      projects.flatMap((p) =>
        p.environments.map((e) => ({ id: e.environmentId, label: `${p.name} / ${e.name}` }))
      ),
    [projects]
  );
  const [target, setTarget] = useState<string>("");
  const targetEnv = target || envOptions[0]?.id;

  function deploy(engine: Engine) {
    setError(null);
    setPendingEngine(engine);
    startTransition(async () => {
      const res = await quickDeployDatabaseAction(engine, targetEnv);
      setPendingEngine(null);
      if (res.ok) {
        setOpen(false);
        onDeployed(res.id);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)]"
      >
        <Plus className="size-4" /> New database
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-2 shadow-2xl"
            >
              <div className="px-2 py-1.5 text-xs text-[var(--color-fg-muted)]">
                Deploys instantly with a random name &amp; password and the latest version.
              </div>

              {envOptions.length > 1 && (
                <select
                  value={targetEnv}
                  onChange={(e) => setTarget(e.target.value)}
                  className="mb-1 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--color-brand)]"
                >
                  {envOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}

              <div className="grid grid-cols-1">
                {ENGINE_LIST.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => deploy(e.id)}
                    disabled={pendingEngine !== null}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--color-surface)] disabled:opacity-50"
                  >
                    <span
                      className="flex size-7 items-center justify-center rounded-md"
                      style={{ backgroundColor: `${e.accent}1a`, color: e.accent }}
                    >
                      {pendingEngine === e.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <DatabaseIcon className="size-4" />
                      )}
                    </span>
                    <span className="flex-1">{e.label}</span>
                    <span className="text-[11px] text-[var(--color-fg-subtle)]">
                      {e.image}:{e.versions[0]}
                    </span>
                  </button>
                ))}
              </div>

              {error && (
                <div className="mt-1 flex items-start gap-1.5 px-2 py-1.5 text-xs text-[var(--color-danger)]">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
