"use client";

import { useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Database as DatabaseIcon, X, RefreshCw, Loader2 } from "lucide-react";
import type { Engine, ProjectNode } from "@/lib/dokploy";
import { ENGINE_LIST, ENGINE_META } from "@/lib/engines";
import { createDatabaseAction, createProjectAction } from "@/app/actions";
import { cn } from "@/lib/utils";

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length: 20 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function NewDatabaseDialog({
  open,
  onClose,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectNode[];
}) {
  const envOptions = useMemo(
    () =>
      projects.flatMap((p) =>
        p.environments.map((e) => ({
          id: e.environmentId,
          label: `${p.name} / ${e.name}`,
        }))
      ),
    [projects]
  );

  const [engine, setEngine] = useState<Engine>("postgres");
  const [name, setName] = useState("");
  const [version, setVersion] = useState(ENGINE_META.postgres.versions[0]);
  const [environmentId, setEnvironmentId] = useState(envOptions[0]?.id ?? "");
  const [user, setUser] = useState("admin");
  const [password, setPassword] = useState(randomPassword);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [newProject, setNewProject] = useState("");
  const [creatingProject, startProject] = useTransition();

  const meta = ENGINE_META[engine];

  function pickEngine(e: Engine) {
    setEngine(e);
    setVersion(ENGINE_META[e].versions[0]);
  }

  function submit() {
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (!environmentId) return setError("Pick a project / environment.");
    startTransition(async () => {
      const res = await createDatabaseAction({
        engine,
        name: name.trim(),
        environmentId,
        databaseUser: meta.hasUser ? user : undefined,
        databaseName: meta.hasDatabaseName ? name.trim() : undefined,
        databasePassword: password,
        dockerImage: `${meta.image}:${version}`,
      });
      if (res.ok) {
        onClose();
        setName("");
        setPassword(randomPassword());
      } else setError(res.error);
    });
  }

  function addProject() {
    if (!newProject.trim()) return;
    startProject(async () => {
      const res = await createProjectAction(newProject.trim());
      if (res.ok) setNewProject("");
      else setError(res.error);
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <h2 className="text-sm font-semibold">New database</h2>
              <button
                onClick={onClose}
                className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
              {/* Engine picker */}
              <div>
                <Label>Engine</Label>
                <div className="grid grid-cols-5 gap-2">
                  {ENGINE_LIST.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => pickEngine(e.id)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-[11px] transition-colors",
                        engine === e.id
                          ? "border-transparent text-[var(--color-fg)]"
                          : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]"
                      )}
                      style={
                        engine === e.id
                          ? { backgroundColor: `${e.accent}1a`, boxShadow: `inset 0 0 0 1px ${e.accent}` }
                          : undefined
                      }
                    >
                      <DatabaseIcon className="size-4" style={{ color: e.accent }} />
                      {e.short}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Name">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-database"
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Version">
                  <select
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    className={inputCls}
                  >
                    {meta.versions.map((v) => (
                      <option key={v} value={v}>
                        {meta.image}:{v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Project / Environment">
                  {envOptions.length > 0 ? (
                    <select
                      value={environmentId}
                      onChange={(e) => setEnvironmentId(e.target.value)}
                      className={inputCls}
                    >
                      {envOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        value={newProject}
                        onChange={(e) => setNewProject(e.target.value)}
                        placeholder="new project name"
                        className={inputCls}
                      />
                      <button
                        onClick={addProject}
                        disabled={creatingProject}
                        className="shrink-0 rounded-lg bg-[var(--color-brand-strong)] px-3 text-xs font-medium text-white hover:bg-[var(--color-brand)] disabled:opacity-50"
                      >
                        {creatingProject ? <Loader2 className="size-4 animate-spin" /> : "Add"}
                      </button>
                    </div>
                  )}
                </Field>
              </div>

              {meta.hasUser && (
                <Field label="User">
                  <input value={user} onChange={(e) => setUser(e.target.value)} className={inputCls} />
                </Field>
              )}

              <Field label="Password">
                <div className="flex gap-2">
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={cn(inputCls, "font-mono")}
                  />
                  <button
                    onClick={() => setPassword(randomPassword())}
                    className="shrink-0 rounded-lg border border-[var(--color-border-strong)] px-3 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]"
                    title="Regenerate"
                  >
                    <RefreshCw className="size-4" />
                  </button>
                </div>
              </Field>

              {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
              <button
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-50"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                Create & deploy
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)]";

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-medium text-[var(--color-fg-muted)]">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
