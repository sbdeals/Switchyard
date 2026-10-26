"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, Layers, Loader2, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getProjectSettingsAction,
  updateProjectAction,
  renameEnvironmentAction,
  removeProjectAction,
  type ActionResult,
} from "@/app/actions";
import {
  canRenameEnvironment,
  projectInventoryKey,
  projectResources,
  requiresRunningConfirmation,
  validateEnvironmentName,
  validateProjectDeletion,
  validateProjectDetails,
  type ProjectSettings as Settings,
} from "@/lib/project-settings";

const inputClass = "w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50 disabled:opacity-50";
const buttonClass = "rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40";

export function ProjectSettings({
  projectId,
  selectedProjectId,
  onBack,
  onDeleted,
}: {
  projectId: string;
  selectedProjectId: string | null;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [project, setProject] = useState<Settings>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tab, setTab] = useState<"general" | "danger">("general");
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingEnv, setEditingEnv] = useState<string | null>(null);
  const [environmentName, setEnvironmentName] = useState("");
  const [typedName, setTypedName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let active = true;
    getProjectSettingsAction(projectId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setProject(result.project);
        setName(result.project.name);
        setDescription(result.project.description);
      } else {
        setError(result.error);
      }
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError("Could not load project settings. Try opening them again.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [projectId]);

  const save = (action: () => Promise<ActionResult>, message: string) => {
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const refreshed = await getProjectSettingsAction(projectId);
        if (refreshed.ok) {
          setProject(refreshed.project);
          setName(refreshed.project.name);
          setDescription(refreshed.project.description);
          setEditingEnv(null);
          setTypedName("");
          setAcknowledged(false);
          setNotice(message);
        } else {
          setError(refreshed.error);
        }
        router.refresh();
      } catch {
        setError("Could not save project settings. Please try again.");
      }
    });
  };

  const deleteError = validateProjectDeletion(project, typedName, selectedProjectId, acknowledged);
  const needsAcknowledgement = project ? requiresRunningConfirmation(project, selectedProjectId) : false;
  const resources = project ? projectResources(project) : [];

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <button type="button" onClick={onBack} disabled={pending} className="mb-4 inline-flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-40">
        <ArrowLeft className="size-3.5" /> Back to projects
      </button>
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]"><Loader2 className="size-4 animate-spin" /> Loading project settings…</p>}
      {error && <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">{error}</p>}
      {notice && <p role="status" className="mb-4 text-sm text-[var(--color-fg-muted)]">{notice}</p>}
      {project && (
        <>
          <p className="mb-3 break-words text-sm font-medium">{project.name}</p>
          <nav aria-label="Project settings sections" className="mb-5 flex gap-1 border-b border-[var(--color-border)] pb-2">
            {(["general", "danger"] as const).map((section) => (
              <button
                key={section}
                type="button"
                aria-pressed={tab === section}
                onClick={() => setTab(section)}
                className={"rounded-lg px-3 py-2 text-xs font-medium " + (tab === section ? "bg-[var(--color-surface-hover)] text-[var(--color-fg)]" : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]")}
              >
                {section === "general" ? "General" : "Danger"}
              </button>
            ))}
          </nav>
          {tab === "general" ? (
            <div className="space-y-6">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const validation = validateProjectDetails(name, description);
                  if (validation) { setError(validation); return; }
                  save(() => updateProjectAction(projectId, name, description), "Project settings saved.");
                }}
              >
                <label className="block space-y-1.5 text-xs font-medium">
                  <span>Project name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} disabled={pending} className={inputClass} />
                </label>
                <label className="block space-y-1.5 text-xs font-medium">
                  <span>Description</span>
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={pending} rows={3} className={inputClass + " resize-y"} />
                </label>
                <button type="submit" disabled={pending || !!validateProjectDetails(name, description)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40">
                  {pending && <Loader2 className="size-3.5 animate-spin" />} Save changes
                </button>
              </form>
              <section className="space-y-3" aria-labelledby="project-environments-title">
                <h3 id="project-environments-title" className="text-sm font-medium">Environments</h3>
                {project.environments.map((environment) => (
                  <div key={environment.environmentId} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <div className="flex items-center gap-2">
                      <Layers className="size-4 shrink-0 text-[var(--color-fg-subtle)]" />
                      <span className="min-w-0 flex-1 break-words text-sm">{environment.name}</span>
                      <span className="shrink-0 text-xs text-[var(--color-fg-muted)]">{environment.services.length} {environment.services.length === 1 ? "service" : "services"}</span>
                      {canRenameEnvironment(environment) && editingEnv !== environment.environmentId && (
                        <button type="button" disabled={pending} aria-label={`Rename ${environment.name} environment`} onClick={() => { setEditingEnv(environment.environmentId); setEnvironmentName(environment.name); }} className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] disabled:opacity-40">
                          <Pencil className="size-3.5" />
                        </button>
                      )}
                    </div>
                    {editingEnv === environment.environmentId && (
                      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
                        event.preventDefault();
                        const validation = validateEnvironmentName(environment, environmentName);
                        if (validation) { setError(validation); return; }
                        save(() => renameEnvironmentAction(environment.environmentId, environmentName), "Environment renamed.");
                      }}>
                        <input aria-label="Environment name" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} disabled={pending} className={inputClass} />
                        <button type="submit" disabled={pending || !!validateEnvironmentName(environment, environmentName)} className={buttonClass}>Save environment</button>
                        <button type="button" disabled={pending} onClick={() => setEditingEnv(null)} className={buttonClass}>Cancel</button>
                      </form>
                    )}
                  </div>
                ))}
                {project.environments.length === 0 && <p className="text-xs text-[var(--color-fg-muted)]">No environments.</p>}
                <p className="text-xs text-[var(--color-fg-subtle)]">Production and default environments cannot be renamed.</p>
              </section>
            </div>
          ) : (
            <section className="space-y-4 rounded-xl border border-[var(--color-danger)]/40 p-4" aria-labelledby="delete-project-title">
              <div>
                <h3 id="delete-project-title" className="text-sm font-semibold text-[var(--color-danger)]">Delete project</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-fg-muted)]">This permanently removes the project and every environment. Services and databases listed below will be deleted. Compose volumes are retained. This cannot be undone.</p>
              </div>
              {!project.canDelete && <p role="alert" className="text-xs text-[var(--color-danger)]">Only organization owners and admins can delete projects because members may not see every service.</p>}
              {resources.length ? (
                <ul aria-label="Services and databases to be deleted" className="space-y-2">
                  {resources.map((resource) => (
                    <li key={`${resource.kind}:${resource.id}`} className="rounded-lg bg-[var(--color-surface)] px-3 py-2">
                      <p className="break-words text-sm font-medium">{resource.name}</p>
                      <p className="text-xs text-[var(--color-fg-muted)]"><span className="capitalize">{resource.kind}</span> · {resource.environmentName}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-[var(--color-fg-muted)]">This project has no services or databases.</p>}
              {needsAcknowledgement && (
                <label className="flex items-start gap-2 text-xs leading-relaxed text-[var(--color-fg-muted)]">
                  <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={pending} className="mt-0.5 accent-[var(--color-danger)]" />
                  <span>I understand running services will be stopped</span>
                </label>
              )}
              <label className="block space-y-1.5 text-xs text-[var(--color-fg-muted)]">
                <span>Type <strong className="break-words text-[var(--color-fg)]">{project.name}</strong> to confirm deletion</span>
                <input aria-label="Project name confirmation" value={typedName} onChange={(event) => setTypedName(event.target.value)} disabled={pending} autoComplete="off" spellCheck={false} className={inputClass} />
              </label>
              <button
                type="button"
                disabled={pending || !!deleteError}
                onClick={() => {
                  if (deleteError) { setError(deleteError); return; }
                  setError(null);
                  setNotice(null);
                  start(async () => {
                    try {
                      const result = await removeProjectAction(projectId, typedName, selectedProjectId, acknowledged, projectInventoryKey(project));
                      if (!result.ok) {
                        setError(result.error);
                        const refreshed = await getProjectSettingsAction(projectId).catch(() => null);
                        if (refreshed?.ok) setProject(refreshed.project);
                        setTypedName("");
                        setAcknowledged(false);
                        router.refresh();
                        return;
                      }
                      router.refresh();
                      onDeleted();
                    } catch {
                      setError("Could not delete this project. Please try again.");
                    }
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-danger)] px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Delete project
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
