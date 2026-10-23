"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  Database as DatabaseIcon,
  Box,
  Layers,
  GitBranch,
  GitFork,
  Loader2,
  AlertCircle,
  LayoutTemplate,
  Search,
  ChevronDown,
  X,
} from "lucide-react";
import type { Engine, ProjectNode, DokployTemplate } from "@/lib/dokploy";
import type { DeployTarget } from "@/lib/deploy-target";
import { ENGINE_LIST } from "@/lib/engines";
import { DEPLOY_SAMPLES, quickDeployOptions } from "@/lib/quick-deploy";
import { cn } from "@/lib/utils";
import {
  quickDeployDatabaseAction,
  quickDeployImageAction,
  quickDeployRepoAction,
  createComposeAction,
  listTemplatesAction,
  quickDeployTemplateAction,
} from "@/app/actions";
import { GithubDeployModal } from "@/components/GithubDeployModal";
import { useDialogFocus } from "@/components/use-focus-trap";

/**
 * Shared deploy flows for the New service menu and first-run chooser. Samples
 * use the same actions, target environment and onDeployed callback as the forms.
 */
export function QuickDeployMenu({
  projects,
  deployTarget,
  onDeployed,
  onboarding = false,
}: {
  projects: ProjectNode[];
  deployTarget: DeployTarget;
  onDeployed: (id: string) => void;
  onboarding?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [flow, setFlow] = useState<"repo" | "image" | "database" | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const branchId = useId();
  const [, startTransition] = useTransition();
  const options = quickDeployOptions(deployTarget);

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
    if (busy !== null) return;
    setError(null);
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (res.ok) {
        setOpen(false);
        setImage("");
        setRepo("");
        setBranch("main");
        onDeployed(res.id);
      } else setError(res.error);
    });
  }

  const deployDb = (engine: Engine) =>
    run(`db:${engine}`, () => quickDeployDatabaseAction(engine, targetEnv));
  const deployImage = (value = image) => run("app", () => quickDeployImageAction(value, undefined, targetEnv));
  const deployRepo = (url = repo, ref = branch) => run("repo", () => quickDeployRepoAction(url, ref, targetEnv));
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

  const targetSelect = envOptions.length > 1 && (
    <select
      value={targetEnv}
      onChange={(e) => setTarget(e.target.value)}
      disabled={busy !== null}
      aria-label="Target project and environment"
      className="mb-1 w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
    >
      {envOptions.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  );
  const choices = [
    { flow: "repo", label: "Git repository", description: options.repoHint, icon: GitBranch },
    { flow: "image", label: "Docker image", description: "Deploy a container image from a registry.", icon: Box },
    { flow: "database", label: "Database", description: "Pick an engine. We handle the credentials and storage.", icon: DatabaseIcon },
  ] as const;

  return (
    <div className={cn("relative", onboarding && "w-full max-w-4xl")}>
      {onboarding ? (
        <>
          <div className="mx-auto mb-3 max-w-xs">{targetSelect}</div>
          <div className="grid gap-3 text-left sm:grid-cols-3">
            {choices.map((choice) => (
              <div key={choice.flow} className="flex min-w-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setFlow(choice.flow);
                    setOpen(true);
                  }}
                  disabled={busy !== null}
                  aria-haspopup="dialog"
                  aria-expanded={open && flow === choice.flow}
                  className="flex flex-1 flex-col items-start rounded-lg p-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:opacity-40"
                >
                  <choice.icon className="mb-3 size-5 text-[var(--color-brand)]" />
                  <span className="text-sm font-medium">{choice.label}</span>
                  <span className="mt-1 text-xs text-[var(--color-fg-muted)]">{choice.description}</span>
                </button>
                {choice.flow !== "database" && (
                  <button
                    type="button"
                    onClick={() => choice.flow === "repo"
                      ? deployRepo(DEPLOY_SAMPLES.repo.url, DEPLOY_SAMPLES.repo.branch)
                      : deployImage(DEPLOY_SAMPLES.image)}
                    disabled={busy !== null}
                    aria-label={`Try a sample ${choice.label.toLowerCase()}: ${choice.flow === "repo" ? "docker/welcome-to-docker, branch main" : DEPLOY_SAMPLES.image}`}
                    className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:opacity-40"
                  >
                    {busy === (choice.flow === "repo" ? "repo" : "app") && <Loader2 className="size-3.5 animate-spin" />}
                    <span className="shrink-0">Try a sample</span>
                    <span className="truncate font-mono text-[10px] text-[var(--color-fg-subtle)]">
                      {choice.flow === "repo" ? "welcome-to-docker" : DEPLOY_SAMPLES.image}
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
          {busy && !open && <p role="status" className="mt-3 text-xs text-[var(--color-fg-muted)]">Deploying service…</p>}
          {error && !open && <p role="alert" className="mt-3 text-xs text-[var(--color-danger)]">{error}</p>}
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)]"
        >
          <Plus className="size-4" /> New service
        </button>
      )}

      <AnimatePresence>
        {open && (
          <>
            <div className={cn("fixed inset-0 z-40", onboarding && "bg-black/50")} onClick={() => setOpen(false)} />
            <FocusTrapPanel
              onClose={() => setOpen(false)}
              role="dialog"
              aria-modal="true"
              aria-label={choices.find((c) => c.flow === flow)?.label ?? "New service"}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className={cn(
                "z-50 max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-2 text-left shadow-2xl",
                onboarding ? "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" : "absolute right-0 mt-2"
              )}
            >
              {flow && (
                <div className="mb-2 flex items-center justify-between px-2 pt-1">
                  <h3 className="text-sm font-medium">{choices.find((c) => c.flow === flow)?.label}</h3>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close deploy menu" className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">
                    <X className="size-4" />
                  </button>
                </div>
              )}
              {targetSelect}

              {!flow && <SectionLabel>Application</SectionLabel>}
              {(!flow || flow === "image") && (
                <div className="mb-1 flex items-center gap-1.5 rounded-lg px-1 py-1">
                  <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                    <Box className="size-4" />
                  </span>
                  <input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && image.trim() && deployImage()}
                    placeholder="docker image, e.g. nginx:alpine"
                    aria-label="Docker image"
                    data-autofocus={flow === "image" ? "" : undefined}
                    className="min-w-0 flex-1 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 py-1.5 text-xs outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                  />
                  <button
                    onClick={() => deployImage()}
                    disabled={!image.trim() || busy !== null}
                    className="shrink-0 rounded-md bg-[var(--color-brand-strong)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
                  >
                    {busy === "app" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span className="sr-only">Deploying</span>
                      </>
                    ) : (
                      "Deploy"
                    )}
                  </button>
                </div>
              )}
              {(!flow || flow === "repo") && (
                <>
                  {deployTarget === "bridge" && <p className="px-2 pb-2 text-xs text-[var(--color-fg-muted)]">{options.repoHint}</p>}
                  <div className="mb-1 flex items-center gap-1.5 rounded-lg px-1 py-1">
                    <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                      <GitBranch className="size-4" />
                    </span>
                    <input
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && repo.trim() && deployRepo()}
                      placeholder="public git repo url"
                      aria-label="Git repository URL"
                      data-autofocus={flow === "repo" ? "" : undefined}
                      className="min-w-0 flex-1 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 py-1.5 text-xs outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                    />
                    <button
                      onClick={() => deployRepo()}
                      disabled={!repo.trim() || busy !== null}
                      className="shrink-0 rounded-md bg-[var(--color-brand-strong)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
                    >
                      {busy === "repo" ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          <span className="sr-only">Deploying</span>
                        </>
                      ) : (
                        "Deploy"
                      )}
                    </button>
                  </div>
                  <div className="mb-2 flex items-center gap-2 pl-10 pr-1">
                    <label htmlFor={branchId} className="text-xs text-[var(--color-fg-muted)]">Branch</label>
                    <input
                      id={branchId}
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && repo.trim() && deployRepo()}
                      placeholder="main"
                      className="min-w-0 flex-1 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 py-1.5 text-xs outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                    />
                  </div>
                  {options.github && (
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
                  )}
                </>
              )}
              {!flow && (
                <>
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
                    aria-expanded={showTemplates}
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
                      <div className="mb-1 flex items-center gap-1.5 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 py-1.5 focus-within:border-[var(--color-brand)]">
                        <Search className="size-3.5 shrink-0 text-[var(--color-fg-subtle)]" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search templates (n8n, plausible, ...)"
                          aria-label="Search app catalog"
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
                            ? "No templates available (the template catalog couldn't be reached)."
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
                                ) : (
                                  <TemplateLogo logo={t.logo} />
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
                </>
              )}

              {(!flow || flow === "database") && (
                <>
                  {!flow && <SectionLabel>Database</SectionLabel>}
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
                </>
              )}

              {error && (
                <div role="alert" className="mt-1 flex items-start gap-1.5 px-2 py-1.5 text-xs text-[var(--color-danger)]">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
                </div>
              )}
            </FocusTrapPanel>
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

/**
 * A template's logo, falling back to a generic icon. Template logos are remote
 * CDN assets and many are missing — the CDN soft-404s to an HTML page, which a
 * plain <img> renders as a broken-image glyph. onError swaps in the icon so a
 * missing logo shows a clean placeholder instead of a broken image.
 */
function TemplateLogo({ logo }: { logo: string }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) {
    return <LayoutTemplate className="size-4 text-[var(--color-fg-subtle)]" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote template logos from arbitrary hosts; next/image would need per-host remotePatterns
    <img src={logo} alt="" className="size-5 object-contain" onError={() => setFailed(true)} />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
      {children}
    </div>
  );
}
