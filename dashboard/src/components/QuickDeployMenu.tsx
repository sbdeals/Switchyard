"use client";

import { useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  Database as DatabaseIcon,
  Box,
  Layers,
  GitBranch,
  Loader2,
  AlertCircle,
  LayoutTemplate,
  Search,
  ChevronDown,
} from "lucide-react";
import type { Engine, ProjectNode, DokployTemplate } from "@/lib/dokploy";
import { ENGINE_LIST } from "@/lib/engines";
import {
  quickDeployDatabaseAction,
  quickDeployImageAction,
  quickDeployRepoAction,
  createComposeAction,
  listTemplatesAction,
  quickDeployTemplateAction,
} from "@/app/actions";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState("");
  const [repo, setRepo] = useState("");
  const [, startTransition] = useTransition();

  // Template catalog — lazily loaded from Dokploy the first time it's opened.
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<DokployTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [query, setQuery] = useState("");

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
  const deployTemplate = (id: string) =>
    run(`tpl:${id}`, () => quickDeployTemplateAction(id, targetEnv));

  function toggleTemplates() {
    const next = !showTemplates;
    setShowTemplates(next);
    if (next && templates === null && !loadingTemplates) {
      setLoadingTemplates(true);
      setTemplatesError(null);
      startTransition(async () => {
        const res = await listTemplatesAction();
        setLoadingTemplates(false);
        if (res.ok) setTemplates(res.templates);
        else setTemplatesError(res.error);
      });
    }
  }

  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) =>
      [t.name, t.description, ...t.tags].some((s) => s.toLowerCase().includes(q))
    );
  }, [templates, query]);

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

              <SectionLabel>Templates</SectionLabel>
              <button
                onClick={toggleTemplates}
                className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--color-surface)]"
              >
                <span
                  className="flex size-7 items-center justify-center rounded-md"
                  style={{ backgroundColor: "#a78bfa1a", color: "#a78bfa" }}
                >
                  <LayoutTemplate className="size-4" />
                </span>
                <span className="flex-1">App catalog</span>
                <ChevronDown
                  className={`size-4 text-[var(--color-fg-subtle)] transition-transform ${
                    showTemplates ? "rotate-180" : ""
                  }`}
                />
              </button>

              {showTemplates && (
                <div className="mb-1">
                  <div className="mb-1 flex items-center gap-1.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5">
                    <Search className="size-3.5 shrink-0 text-[var(--color-fg-subtle)]" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search templates (n8n, plausible, ...)"
                      className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--color-fg-subtle)]"
                    />
                  </div>

                  {loadingTemplates ? (
                    <div className="flex items-center gap-1.5 px-2 py-3 text-xs text-[var(--color-fg-subtle)]">
                      <Loader2 className="size-3.5 animate-spin" /> Loading catalog…
                    </div>
                  ) : templatesError ? (
                    <div className="flex items-start gap-1.5 px-2 py-2 text-xs text-[var(--color-danger)]">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {templatesError}
                    </div>
                  ) : templates && filteredTemplates.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-[var(--color-fg-subtle)]">
                      {templates.length === 0
                        ? "No templates available (Dokploy could not reach its template source)."
                        : "No templates match your search."}
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      {filteredTemplates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => deployTemplate(t.id)}
                          disabled={busy !== null}
                          title={t.description}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--color-surface)] disabled:opacity-50"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--color-surface)]">
                            {busy === `tpl:${t.id}` ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : t.logo ? (
                              // eslint-disable-next-line @next/next/no-img-element -- remote template logos from arbitrary hosts; next/image would need per-host remotePatterns
                              <img src={t.logo} alt="" className="size-5 object-contain" />
                            ) : (
                              <LayoutTemplate className="size-4 text-[var(--color-fg-subtle)]" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{t.name}</span>
                            <span className="block truncate text-[11px] text-[var(--color-fg-subtle)]">
                              {t.description}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

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
