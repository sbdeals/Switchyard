"use client";

import { useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Database as DatabaseIcon, Box, Layers, GitBranch, GitFork, Loader2, AlertCircle } from "lucide-react";
import type { Engine, ProjectNode } from "@/lib/dokploy";
import { ENGINE_LIST } from "@/lib/engines";
import {
  quickDeployDatabaseAction,
  quickDeployImageAction,
  quickDeployRepoAction,
  createComposeAction,
} from "@/app/actions";
import { GithubDeployModal } from "@/components/GithubDeployModal";

/**
 * One-click provisioning: pick a database engine (auto name/password/version) or
 * deploy an application from a Docker image. Everything is editable afterward in
 * the service drawer.
 */
export function QuickDeployMenu({
  projects,
  onDeployed,
}: {
  projects: ProjectNode[];
  onDeployed: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState("");
  const [repo, setRepo] = useState("");
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

  function run(key: string, fn: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>) {
    setError(null);
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (res.ok) {
        setOpen(false);
        setImage("");
        setRepo("");
        onDeployed(res.id);
      } else setError(res.error);
    });
  }

  const deployDb = (engine: Engine) =>
    run(`db:${engine}`, () => quickDeployDatabaseAction(engine, targetEnv));
  const deployImage = () => run("app", () => quickDeployImageAction(image, undefined, targetEnv));
  const deployRepo = () => run("repo", () => quickDeployRepoAction(repo, undefined, targetEnv));
  const createComposeStack = () => run("compose", () => createComposeAction(undefined, targetEnv));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)]"
      >
        <Plus className="size-4" /> New service
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
              className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-2 shadow-2xl"
            >
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

              <SectionLabel>Application</SectionLabel>
              <div className="mb-1 flex items-center gap-1.5 rounded-lg px-1 py-1">
                <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                  <Box className="size-4" />
                </span>
                <input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && image.trim() && deployImage()}
                  placeholder="docker image, e.g. nginx:alpine"
                  className="min-w-0 flex-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-xs outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)]"
                />
                <button
                  onClick={deployImage}
                  disabled={!image.trim() || busy !== null}
                  className="shrink-0 rounded-md bg-[var(--color-brand-strong)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
                >
                  {busy === "app" ? <Loader2 className="size-4 animate-spin" /> : "Deploy"}
                </button>
              </div>
              <div className="mb-1 flex items-center gap-1.5 rounded-lg px-1 py-1">
                <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                  <GitBranch className="size-4" />
                </span>
                <input
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && repo.trim() && deployRepo()}
                  placeholder="git repo url (Nixpacks build)"
                  className="min-w-0 flex-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-xs outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)]"
                />
                <button
                  onClick={deployRepo}
                  disabled={!repo.trim() || busy !== null}
                  className="shrink-0 rounded-md bg-[var(--color-brand-strong)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
                >
                  {busy === "repo" ? <Loader2 className="size-4 animate-spin" /> : "Deploy"}
                </button>
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  setGithubOpen(true);
                }}
                className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--color-surface)]"
              >
                <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-surface)] text-[var(--color-fg)]">
                  <GitFork className="size-4" />
                </span>
                <span className="flex-1">From GitHub</span>
                <span className="text-[11px] text-[var(--color-fg-subtle)]">private repos</span>
              </button>
              <button
                onClick={createComposeStack}
                disabled={busy !== null}
                className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--color-surface)] disabled:opacity-50"
              >
                <span
                  className="flex size-7 items-center justify-center rounded-md"
                  style={{ backgroundColor: "#2dd4bf1a", color: "#2dd4bf" }}
                >
                  {busy === "compose" ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />}
                </span>
                <span className="flex-1">Compose stack</span>
                <span className="text-[11px] text-[var(--color-fg-subtle)]">docker-compose</span>
              </button>

              <SectionLabel>Database</SectionLabel>
              <div className="grid grid-cols-1">
                {ENGINE_LIST.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => deployDb(e.id)}
                    disabled={busy !== null}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--color-surface)] disabled:opacity-50"
                  >
                    <span
                      className="flex size-7 items-center justify-center rounded-md"
                      style={{ backgroundColor: `${e.accent}1a`, color: e.accent }}
                    >
                      {busy === `db:${e.id}` ? (
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

      <GithubDeployModal
        open={githubOpen}
        onClose={() => setGithubOpen(false)}
        environmentId={targetEnv}
        onDeployed={onDeployed}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
      {children}
    </div>
  );
}
