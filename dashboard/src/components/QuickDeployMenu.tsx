"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
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
import { ENGINE_LIST } from "@/lib/engines";
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
import { anchoredMenuPosition, type Point } from "@/lib/canvas-layout";

/**
 * One-click provisioning: pick a database engine (auto name/password/version) or
 * deploy an application from a Docker image. Everything is editable afterward in
 * the service drawer.
 */
export function QuickDeployMenu({
  projects,
  onDeployed,
  anchor,
  onClose,
  variant = "menu",
  menuOpen,
  onMenuOpenChange,
}: {
  projects: ProjectNode[];
  onDeployed: (id: string) => void;
  anchor?: Point;
  onClose?: () => void;
  variant?: "menu" | "cards";
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(!!anchor);
  const open = menuOpen ?? localOpen;
  function setOpen(next: boolean) {
    setLocalOpen(next);
    onMenuOpenChange?.(next);
  }
  const [source, setSource] = useState<"repo" | "image" | "database">("image");
  const [githubOpen, setGithubOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("");
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
  const targetEnv = envOptions.some((option) => option.id === target) ? target : envOptions[0]?.id;
  const missingEnvironment = projects.length > 0 && envOptions.length === 0;
  const environmentError = "Add an environment in Projects before deploying a service.";

  function close() {
    setOpen(false);
    onClose?.();
  }

  function run(key: string, fn: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>) {
    if (missingEnvironment) {
      setError(environmentError);
      return;
    }
    setError(null);
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (res.ok) {
        setOpen(false);
        setImage("");
        setName("");
        setPort("");
        setRepo("");
        onDeployed(res.id);
      } else setError(res.error);
    });
  }

  const deployDb = (engine: Engine) =>
    run(`db:${engine}`, () => quickDeployDatabaseAction(engine, targetEnv));
  const deployImage = () => run("app", () => quickDeployImageAction(image, name.trim() || undefined, targetEnv, port));
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

  const cards = variant === "cards";
  const title = !cards
    ? "New service"
    : source === "repo"
      ? "Deploy from GitHub repo"
      : source === "image"
        ? "Deploy a Docker image"
        : "Add a database";

  const content = (
    <div className="relative max-lg:[&_button]:min-h-10 max-lg:[&_button]:min-w-10 max-lg:[&_input]:min-h-10 max-lg:[&_select]:min-h-10">
      {cards ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            { source: "repo", label: "Deploy from GitHub repo", description: "Build and deploy your code.", Icon: GitBranch },
            { source: "image", label: "Deploy a Docker image", description: "Run a ready-to-use container.", Icon: Box },
            { source: "database", label: "Add a database", description: "Give your app a place for its data.", Icon: DatabaseIcon },
          ] as const).map((action) => (
            <button
              key={action.source}
              onClick={() => {
                setSource(action.source);
                setError(null);
                setOpen(true);
              }}
              aria-haspopup="dialog"
              aria-expanded={open && source === action.source}
              className="flex flex-col items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 text-left transition-colors hover:border-[var(--color-brand)] hover:bg-[var(--color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                <action.Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold">{action.label}</span>
              <span className="text-xs text-[var(--color-fg-muted)]">{action.description}</span>
            </button>
          ))}
        </div>
      ) : !anchor && <button
        onClick={() => setOpen(!open)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)]"
      >
        <Plus className="size-4" /> New service
      </button>}

      <AnimatePresence>
        {open && (
          <>
            <div className={`fixed inset-0 z-40 ${cards ? "bg-black/50" : ""}`} onClick={close} />
            <FocusTrapPanel
              onClose={close}
              anchor={anchor}
              role="dialog"
              aria-label={title}
              aria-modal={cards ? true : undefined}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className={cards
                ? "fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-2xl"
                : `fixed left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-50 max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top))-max(1rem,env(safe-area-inset-bottom)))] overflow-y-auto overscroll-contain rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-2 shadow-2xl sm:w-80 ${anchor ? "sm:left-[var(--menu-left)] sm:right-auto sm:top-[var(--menu-top)] sm:max-h-[calc(100dvh-1rem)] sm:max-w-[calc(100vw-1rem)]" : "sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[calc(100dvh-8rem)]"}`}
            >
              {!cards && (
                <div className="mb-1 flex items-center justify-between pl-2 sm:hidden">
                  <span className="text-sm font-semibold">New service</span>
                  <button
                    onClick={close}
                    aria-label="Close new service"
                    className="flex items-center justify-center rounded-md text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}
              {cards && (
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">{title}</h2>
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="Close deployment dialog"
                    className="rounded-md p-2 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}
              {cards && source === "repo" && (
                <p className="mb-3 text-xs text-[var(--color-fg-muted)]">
                  Paste a public repository URL or choose a connected GitHub repository.
                </p>
              )}
              {envOptions.length > 1 && (
                <select
                  value={targetEnv}
                  onChange={(e) => setTarget(e.target.value)}
                  aria-label="Target project and environment"
                  className="mb-1 w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                >
                  {envOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}

              {!cards && <SectionLabel>Application</SectionLabel>}
              {(!cards || source === "image") && <>
              {cards && (
                <label className="mb-3 block text-xs text-[var(--color-fg-muted)]">
                  Service name (optional)
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-app"
                    className="mt-1.5 w-full rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 py-2 text-sm outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                  />
                </label>
              )}
              <div className="mb-1 flex items-center gap-1.5 rounded-lg px-1 py-1">
                <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                  <Box className="size-4" />
                </span>
                <input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && image.trim() && busy === null && deployImage()}
                  data-autofocus={cards || undefined}
                  placeholder="docker image, e.g. nginx:alpine"
                  aria-label="Docker image"
                  className="min-w-0 flex-1 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 py-1.5 text-xs outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                />
                <button
                  onClick={deployImage}
                  disabled={!image.trim() || busy !== null || missingEnvironment}
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
              <label className="mb-1 flex items-center gap-1.5 px-1 py-1 text-xs text-[var(--color-fg-subtle)]">
                Port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && image.trim() && busy === null && deployImage()}
                  placeholder="Auto"
                  className="w-24 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                />
              </label>
              </>}
              {(!cards || source === "repo") && <>
              <div className="mb-1 flex items-center gap-1.5 rounded-lg px-1 py-1">
                <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                  <GitBranch className="size-4" />
                </span>
                <input
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && repo.trim() && busy === null && deployRepo()}
                  data-autofocus={cards || undefined}
                  placeholder="git repo url (Nixpacks build)"
                  aria-label="Git repository URL"
                  className="min-w-0 flex-1 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 py-1.5 text-xs outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                />
                <button
                  onClick={deployRepo}
                  disabled={!repo.trim() || busy !== null || missingEnvironment}
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
              <button
                disabled={missingEnvironment}
                onClick={() => {
                  setOpen(false);
                  setGithubOpen(true);
                }}
                className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--color-surface)] disabled:opacity-50"
              >
                <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-surface)] text-[var(--color-fg)]">
                  <GitFork className="size-4" />
                </span>
                <span className="flex-1">From GitHub</span>
                <span className="text-[11px] text-[var(--color-fg-subtle)]">private repos</span>
              </button>
              </>}
              {!cards && <>
              <button
                onClick={createComposeStack}
                disabled={busy !== null || missingEnvironment}
                className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--color-surface)] disabled:opacity-50"
              >
                <span
                  className="flex size-7 items-center justify-center rounded-md"
                  style={{ backgroundColor: "var(--color-teal-soft)", color: "var(--color-teal)" }}
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
                  style={{ backgroundColor: "var(--color-violet-soft)", color: "var(--color-violet)" }}
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
                        ? "No templates available (Dokploy could not reach its template source)."
                        : "No templates match your search."}
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      {filteredTemplates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => deployTemplate(t.id)}
                          disabled={busy !== null || missingEnvironment}
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
              </>}

              {(!cards || source === "database") && <>
              {!cards && <SectionLabel>Database</SectionLabel>}
              <div className="grid grid-cols-1">
                {ENGINE_LIST.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => deployDb(e.id)}
                    disabled={busy !== null || missingEnvironment}
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
                    <span className="min-w-0 truncate text-[11px] text-[var(--color-fg-subtle)]">
                      {e.image}:{e.versions[0]}
                    </span>
                  </button>
                ))}
              </div>
              </>}

              {(error || missingEnvironment) && (
                <div role="alert" className="mt-1 flex items-start gap-1.5 px-2 py-1.5 text-xs text-[var(--color-danger)]">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error || environmentError}
                </div>
              )}
            </FocusTrapPanel>
          </>
        )}
      </AnimatePresence>

      <GithubDeployModal
        open={githubOpen && !missingEnvironment}
        onClose={() => {
          setGithubOpen(false);
          onClose?.();
        }}
        environmentId={targetEnv}
        onDeployed={onDeployed}
      />
    </div>
  );
  return anchor ? createPortal(content, document.body) : content;
}

/**
 * motion.div that mounts and unmounts with the overlay it renders, so
 * useDialogFocus (whose effect runs on mount) can trap focus for exactly the
 * overlay's lifetime.
 */
function FocusTrapPanel({
  onClose,
  anchor,
  ...props
}: { onClose: () => void; anchor?: Point } & React.ComponentProps<typeof motion.div>) {
  const focusRef = useDialogFocus<HTMLDivElement>(onClose);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    focusRef(node);
    panelRef.current = node;
  }, [focusRef]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    // Measure again when the catalog expands or the viewport changes.
    const position = () => {
      const point = anchoredMenuPosition(anchor,
        { width: window.innerWidth, height: window.innerHeight },
        { width: panel.offsetWidth, height: panel.offsetHeight });
      panel.style.setProperty("--menu-left", `${point.x}px`);
      panel.style.setProperty("--menu-top", `${point.y}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [anchor]);

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
