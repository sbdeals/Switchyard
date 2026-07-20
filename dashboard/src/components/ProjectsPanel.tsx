"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Plus, Pencil, Trash2, FolderGit2, Layers, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ProjectNode } from "@/lib/dokploy";
import {
  createProjectAction,
  renameProjectAction,
  removeProjectAction,
  createEnvironmentAction,
  renameEnvironmentAction,
  removeEnvironmentAction,
  type ActionResult,
} from "@/app/actions";
import { useDialogFocus } from "@/components/use-focus-trap";

export function ProjectsPanel({
  open,
  onClose,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectNode[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newProject, setNewProject] = useState("");
  const [newEnv, setNewEnv] = useState<Record<string, string>>({});

  const act = (fn: () => Promise<ActionResult>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  const rename = (current: string, fn: (name: string) => Promise<ActionResult>) => {
    const name = prompt("New name", current);
    if (name && name.trim() && name !== current) act(() => fn(name.trim()));
  };

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
          <FocusTrapPanel
            onClose={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="projects-panel-title"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <h2 id="projects-panel-title" className="text-sm font-semibold">Projects &amp; environments</h2>
              <button
                onClick={onClose}
                aria-label="Close projects"
                className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {projects.map((p) => (
                <div
                  key={p.projectId}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="size-4 text-[var(--color-brand)]" />
                    <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                    <IconBtn title="Rename project" onClick={() => rename(p.name, (n) => renameProjectAction(p.projectId, n))}>
                      <Pencil className="size-3.5" />
                    </IconBtn>
                    <IconBtn
                      title="Delete project"
                      danger
                      onClick={() => {
                        if (confirm(`Delete project "${p.name}" and everything in it?`))
                          act(() => removeProjectAction(p.projectId));
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </IconBtn>
                  </div>

                  <div className="mt-2 space-y-1 pl-6">
                    {p.environments.map((e) => (
                      <div key={e.environmentId} className="flex items-center gap-2 text-xs">
                        <Layers className="size-3.5 text-[var(--color-fg-subtle)]" />
                        <span className="flex-1 truncate text-[var(--color-fg-muted)]">{e.name}</span>
                        <IconBtn title="Rename environment" onClick={() => rename(e.name, (n) => renameEnvironmentAction(e.environmentId, n))}>
                          <Pencil className="size-3" />
                        </IconBtn>
                        <IconBtn
                          title="Delete environment"
                          danger
                          onClick={() => {
                            if (confirm(`Delete environment "${e.name}"?`))
                              act(() => removeEnvironmentAction(e.environmentId));
                          }}
                        >
                          <Trash2 className="size-3" />
                        </IconBtn>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 pt-1">
                      <input
                        value={newEnv[p.projectId] ?? ""}
                        onChange={(ev) => setNewEnv((m) => ({ ...m, [p.projectId]: ev.target.value }))}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" && (newEnv[p.projectId] ?? "").trim()) {
                            act(() => createEnvironmentAction(p.projectId, newEnv[p.projectId].trim()));
                            setNewEnv((m) => ({ ...m, [p.projectId]: "" }));
                          }
                        }}
                        placeholder="new environment"
                        aria-label="New environment name"
                        className="min-w-0 flex-1 rounded-md border border-[var(--color-border-control)] bg-[var(--color-bg-elevated)] px-2 py-1 text-xs outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                      />
                      <button
                        onClick={() => {
                          if ((newEnv[p.projectId] ?? "").trim()) {
                            act(() => createEnvironmentAction(p.projectId, newEnv[p.projectId].trim()));
                            setNewEnv((m) => ({ ...m, [p.projectId]: "" }));
                          }
                        }}
                        className="shrink-0 rounded-md border border-[var(--color-border-strong)] px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]"
                      >
                        Add env
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {projects.length === 0 && (
                <p className="text-center text-xs text-[var(--color-fg-subtle)]">No projects yet.</p>
              )}
            </div>

            <div className="border-t border-[var(--color-border)] px-5 py-4">
              {error && <p role="alert" className="mb-2 text-xs text-[var(--color-danger)]">{error}</p>}
              <div className="flex items-center gap-2">
                <input
                  value={newProject}
                  onChange={(e) => setNewProject(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newProject.trim()) {
                      act(() => createProjectAction(newProject.trim()));
                      setNewProject("");
                    }
                  }}
                  placeholder="new project name"
                  aria-label="New project name"
                  className="flex-1 rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                />
                <button
                  onClick={() => {
                    if (newProject.trim()) {
                      act(() => createProjectAction(newProject.trim()));
                      setNewProject("");
                    }
                  }}
                  disabled={pending || !newProject.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Project
                </button>
              </div>
            </div>
          </FocusTrapPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * motion.div that mounts and unmounts with the overlay it renders, so
 * useDialogFocus (whose effect runs on mount) can trap focus for exactly the
 * overlay's lifetime.
 */
function FocusTrapPanel({
  onClose,
  ...props
}: { onClose: () => void } & React.ComponentProps<typeof motion.div>) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  return <motion.div {...props} ref={ref} />;
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        "rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-hover)] " +
        (danger ? "hover:text-[var(--color-danger)]" : "hover:text-[var(--color-fg)]")
      }
    >
      {children}
    </button>
  );
}
