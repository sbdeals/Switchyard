"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Activity, AlertTriangle, Boxes, FolderGit2, LayoutGrid, Menu, Network, Plus, RefreshCw, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Service, ProjectNode, ServiceEdge } from "@/lib/dokploy";
import { ServiceCard } from "@/components/ServiceCard";
import { QuickDeployMenu } from "@/components/QuickDeployMenu";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { ServiceDrawer } from "@/components/service/ServiceDrawer";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { resolveServiceDisplay } from "@/lib/service-meta";
import { cn } from "@/lib/utils";

type Health = "all" | "running" | "deploying" | "attention";
type Kind = "all" | Service["kind"];

export function Workspace({ services, projects, edges }: {
  services: Service[]; projects: ProjectNode[]; edges: ServiceEdge[];
}) {
  const [view, setView] = useState<"canvas" | "grid">("canvas");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>("all");
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if ((e.key !== "/" && !(e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) ||
        e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);

  const selected = services.find((s) => s.id === selectedId) ?? null;
  const project = projects.find((p) => p.projectId === projectId);
  const environment = project?.environments.find((e) => e.environmentId === environmentId);
  const scoped = useMemo(() => services.filter((s) =>
    (!projectId || s.projectId === projectId) && (!environmentId || s.environmentId === environmentId)
  ), [services, projectId, environmentId]);
  const counts = useMemo(() => ({
    all: scoped.length,
    running: scoped.filter((s) => resolveServiceDisplay(s.status, s.runtime).label === "Running").length,
    deploying: scoped.filter((s) => s.status === "running").length,
    attention: scoped.filter((s) => resolveServiceDisplay(s.status, s.runtime).attention).length,
  }), [scoped]);
  const visible = useMemo(() => scoped.filter((s) => {
    const status = resolveServiceDisplay(s.status, s.runtime);
    const match = health === "all" || (health === "running" && status.label === "Running") ||
      (health === "deploying" && s.status === "running") || (health === "attention" && !!status.attention);
    const q = query.trim().toLowerCase();
    return match && (kind === "all" || s.kind === kind) &&
      (!q || [s.name, s.dockerImage, s.projectName, s.environmentName].some((v) => v?.toLowerCase().includes(q)));
  }), [scoped, health, kind, query]);
  const ids = useMemo(() => new Set(visible.map((s) => s.id)), [visible]);
  const visibleEdges = useMemo(() => edges.filter((e) => ids.has(e.source) && ids.has(e.target)), [edges, ids]);
  const scopeTo = (p: string | null, e: string | null = null) => {
    setProjectId(p); setEnvironmentId(e); setHealth("all"); setMobileNavOpen(false);
  };
  const onDeployed = (id: string) => { setSelectedId(id); router.refresh(); };
  const scopeName = environment ? `${project?.name} / ${environment.name}` : project?.name ?? "All services";

  const navigation = <div className="flex h-full flex-col">
    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-5">
      <button type="button" onClick={() => scopeTo(null)} className="flex items-center gap-2.5" aria-label="Switchyard, all services">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-brand-strong)] text-white"><Boxes className="size-4" /></span>
        <span className="text-[15px] font-bold tracking-[-0.03em]">switchyard<span className="text-[var(--color-brand)]">.</span></span>
      </button>
      <button type="button" className="text-[var(--color-fg-muted)] lg:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X className="size-5" /></button>
    </div>
    <div className="flex-1 overflow-auto px-3 py-5">
      <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.19em] text-[var(--color-fg-subtle)]">Workspace</div>
      <ScopeButton active={!projectId} onClick={() => scopeTo(null)} icon={<LayoutGrid className="size-4" />} label="All services" count={services.length} />
      <div className="mb-2 mt-7 flex items-center justify-between px-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.19em] text-[var(--color-fg-subtle)]">Projects</span>
        <button type="button" onClick={() => { setProjectsOpen(true); setMobileNavOpen(false); }} aria-label="Manage projects" className="text-[var(--color-fg-subtle)] hover:text-[var(--color-brand)]"><Plus className="size-4" /></button>
      </div>
      {projects.map((p) => <div key={p.projectId}>
        <ScopeButton active={projectId === p.projectId && !environmentId} onClick={() => scopeTo(p.projectId)}
          icon={<FolderGit2 className="size-4" />} label={p.name} count={services.filter((s) => s.projectId === p.projectId).length} />
        {projectId === p.projectId && p.environments.map((e) =>
          <ScopeButton key={e.environmentId} nested active={environmentId === e.environmentId} onClick={() => scopeTo(p.projectId, e.environmentId)}
            icon={<span className="size-1.5 rounded-full bg-current" />} label={e.name} count={services.filter((s) => s.environmentId === e.environmentId).length} />
        )}
      </div>)}
    </div>
    <div className="border-t border-[var(--color-border)] px-5 py-4 text-[11px] leading-5 text-[var(--color-fg-subtle)]">
      <div className="flex items-center gap-2 text-[var(--color-fg-muted)]"><Activity className="size-3.5 text-[var(--color-ok)]" /> Operator workspace</div>
      Self-hosted · Dokploy control plane
    </div>
  </div>;

  return <MotionConfig reducedMotion="user"><div className="min-h-screen lg:pl-[244px]">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] border-r border-[var(--color-border)] bg-[#0d0e13] lg:block">{navigation}</aside>
    <AnimatePresence>{mobileNavOpen && <>
      <motion.div className="fixed inset-0 z-[70] bg-black/70" onClick={() => setMobileNavOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside className="fixed inset-y-0 left-0 z-[71] w-[min(84vw,290px)] border-r border-[var(--color-border-strong)] bg-[#0d0e13]" initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}>{navigation}</motion.aside>
    </>}</AnimatePresence>
    <main className="mx-auto max-w-[1800px] px-4 pb-8 pt-5 sm:px-6 lg:px-8">
      <header className="mb-5 flex min-w-0 items-center justify-between gap-3 border-b border-[var(--color-border)] pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => setMobileNavOpen(true)} className="rounded-lg border border-[var(--color-border-strong)] p-2 lg:hidden" aria-label="Open navigation"><Menu className="size-4" /></button>
          <div className="min-w-0"><div className="truncate text-[10px] uppercase tracking-[0.15em] text-[var(--color-fg-subtle)]">Workspace / {scopeName}</div>
            <h1 className="mt-0.5 truncate text-[22px] font-semibold tracking-[-0.04em] sm:text-[27px]">Control room</h1></div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => router.refresh()} aria-label="Refresh services" title="Refresh services" className="hidden rounded-lg border border-[var(--color-border-strong)] p-2 text-[var(--color-fg-muted)] hover:text-white sm:inline-flex"><RefreshCw className="size-4" /></button>
          <QuickDeployMenu key={environmentId ?? projectId ?? "all"} projects={projects} defaultEnvironmentId={environmentId ?? project?.environments[0]?.environmentId} onDeployed={onDeployed} />
        </div>
      </header>
      <div className="mb-5 flex items-end justify-between gap-2">
        <div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-brand)]">LIVE INVENTORY</div><h2 className="mt-1 text-lg font-semibold tracking-tight">{scopeName}</h2></div>
        <div className="text-xs text-[var(--color-fg-subtle)]">{scoped.length} {scoped.length === 1 ? "service" : "services"}</div>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-border-strong)] md:grid-cols-4">
        {([["all", "All services", counts.all, Boxes], ["running", "Running", counts.running, Activity],
          ["deploying", "Deploying", counts.deploying, RefreshCw], ["attention", "Needs attention", counts.attention, AlertTriangle]] as const)
          .map(([id, label, count, Icon]) => <button type="button" key={id} aria-pressed={health === id}
            onClick={() => setHealth(health === id ? "all" : id)}
            className={cn("flex items-center justify-between gap-2 bg-[var(--color-bg-elevated)] px-3 py-3 text-left hover:bg-[var(--color-surface-hover)] sm:px-4", health === id && "bg-[#29211e]")}>
            <div className="min-w-0"><div className="truncate text-[10px] text-[var(--color-fg-muted)] sm:text-xs">{label}</div><div className={cn("mt-1 text-xl font-semibold tabular-nums", health === id && "text-[var(--color-brand)]")}>{count}</div></div>
            <Icon className={cn("size-4 shrink-0 text-[var(--color-fg-subtle)]", id === "attention" && count > 0 && "text-[var(--color-warn)]")} />
          </button>)}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[175px] flex-1 sm:max-w-[340px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search services"
            placeholder="Search services, images, projects…" className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] py-2 pl-9 pr-8 text-xs outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)]" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"><X className="size-4" /></button>}
        </div>
        <select aria-label="Filter service type" value={kind} onChange={(e) => setKind(e.target.value as Kind)}
          className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs text-[var(--color-fg-muted)] outline-none focus:border-[var(--color-brand)]">
          <option value="all">All types</option><option value="application">Apps</option><option value="database">Databases</option><option value="compose">Compose</option>
        </select>
        <div className="ml-auto flex rounded-lg border border-[var(--color-border-strong)] p-0.5">
          <ViewToggle active={view === "canvas"} onClick={() => setView("canvas")}><Network className="size-3.5" /><span className="hidden sm:inline">Canvas</span></ViewToggle>
          <ViewToggle active={view === "grid"} onClick={() => setView("grid")}><LayoutGrid className="size-3.5" /><span className="hidden sm:inline">Grid</span></ViewToggle>
        </div>
      </div>
      {services.length === 0 ? <EmptyState projects={projects} onDeployed={onDeployed} /> :
        visible.length === 0 ? <div className="flex min-h-[340px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border-strong)] text-center">
          <Search className="size-6 text-[var(--color-fg-subtle)]" /><h3 className="mt-3 text-sm font-medium">No matching services</h3>
          <p className="mt-1 text-xs text-[var(--color-fg-muted)]">Try another search, status, or project.</p>
          <button type="button" onClick={() => { setQuery(""); setKind("all"); setHealth("all"); }} className="mt-4 text-xs font-medium text-[var(--color-brand)]">Clear filters</button>
        </div> : view === "canvas" ?
          <FlowCanvas services={visible} allServices={services} edges={visibleEdges} onSelect={(s) => setSelectedId(s.id)} /> :
          <motion.div layout className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">{visible.map((s) => <ServiceCard key={`${s.kind}:${s.id}`} service={s} onOpen={() => setSelectedId(s.id)} />)}</AnimatePresence>
          </motion.div>}
      <div className="mt-3 text-[10px] text-[var(--color-fg-subtle)]">Select a service for metrics, logs, deployments, and agent tools. Drag the canvas to explore.</div>
    </main>
    <ServiceDrawer service={selected} onClose={() => setSelectedId(null)} />
    <ProjectsPanel open={projectsOpen} onClose={() => setProjectsOpen(false)} projects={projects} />
    <AgentPanel />
  </div></MotionConfig>;
}

function ScopeButton({ active, onClick, icon, label, count, nested = false }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number; nested?: boolean;
}) {
  return <button type="button" aria-current={active ? "page" : undefined} onClick={onClick}
    className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors", nested && "pl-7", active ? "bg-[#29211e] font-medium text-[var(--color-brand)]" : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-white")}>
    {icon}<span className="min-w-0 flex-1 truncate">{label}</span><span className="tabular-nums opacity-65">{count}</span>
  </button>;
}

function ViewToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium", active ? "bg-[var(--color-surface-hover)] text-white" : "text-[var(--color-fg-muted)] hover:text-white")}>{children}</button>;
}

function EmptyState({ projects, onDeployed }: { projects: ProjectNode[]; onDeployed: (id: string) => void }) {
  return <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    className="flex min-h-[440px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border-strong)] px-5 text-center">
    <div className="flex size-12 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><Boxes className="size-6" /></div>
    <h2 className="mt-4 font-medium">Your first service starts here</h2>
    <p className="mb-5 mt-1 max-w-sm text-sm text-[var(--color-fg-muted)]">Deploy a Docker image, connect a repository, or provision a database.</p>
    <QuickDeployMenu projects={projects} onDeployed={onDeployed} />
  </motion.div>;
}
