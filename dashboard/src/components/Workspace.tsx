"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Boxes, RefreshCw, Network, LayoutGrid, FolderGit2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Service, ProjectNode, ServiceEdge } from "@/lib/dokploy";
import { ServiceCard } from "@/components/ServiceCard";
import { QuickDeployMenu } from "@/components/QuickDeployMenu";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { ServiceDrawer } from "@/components/service/ServiceDrawer";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { ContextMenu } from "@/components/ContextMenu";
import { CommandPalette } from "@/components/CommandPalette";
import type { ServiceSection } from "@/components/service/ServiceContextMenu";
import { workspaceMenuItems, type NewServiceKind } from "@/lib/context-menu";
import { cn } from "@/lib/utils";

type View = "canvas" | "grid";

export function Workspace({
  services,
  projects,
  edges,
}: {
  services: Service[];
  projects: ProjectNode[];
  edges: ServiceEdge[];
}) {
  const [view, setView] = useState<View>("canvas");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<ServiceSection>("overview");
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [initialProjectId, setInitialProjectId] = useState<string>();
  const [newServiceOpen, setNewServiceOpen] = useState(false);
  const [newServiceKind, setNewServiceKind] = useState<NewServiceKind>();
  const router = useRouter();
  const deploying = services.some((s) => s.status === "running");
  const refreshing = useAutoRefresh(
    deploying ? DEPLOYING_POLL_MS : selectedId ? DRAWER_POLL_MS : IDLE_POLL_MS
  );

  // Re-resolve the selected service from fresh props so the drawer updates.
  const selected = services.find((s) => s.id === selectedId) ?? null;

  // Open the new service's drawer and pull fresh state in.
  const onDeployed = (id: string) => {
    setSelectedSection("overview");
    setSelectedId(id);
    router.refresh();
  };

  const openService = (service: Service, section: ServiceSection = "overview") => {
    setProjectsOpen(false);
    setNewServiceOpen(false);
    setHighlightedId(service.id);
    setSelectedSection(section);
    setNavigationVersion((version) => version + 1);
    setSelectedId(service.id);
  };

  const openCreate = (kind?: NewServiceKind) => {
    setSelectedId(null);
    setProjectsOpen(false);
    setNewServiceKind(kind);
    setNewServiceOpen(true);
  };

  const openProjects = (projectId?: string) => {
    setSelectedId(null);
    setNewServiceOpen(false);
    setInitialProjectId(projectId);
    setProjectsOpen(true);
  };

  return (
    <MotionConfig reducedMotion="user">
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
              <Boxes className="size-4.5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Services</h1>
          </div>
          <p className="mt-1.5 text-sm text-[var(--color-fg-muted)]">
            Apps, databases and stacks across your projects — status updates live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CommandPalette
            services={services}
            projects={projects}
            focusedService={selected ?? services.find((service) => service.id === highlightedId) ?? null}
            onOpenService={openService}
            onOpenProject={openProjects}
            onCreate={openCreate}
          />
          <div className="flex rounded-lg border border-[var(--color-border-strong)] p-0.5">
            <ViewToggle active={view === "canvas"} onClick={() => setView("canvas")}>
              <Network className="size-3.5" /> Canvas
            </ViewToggle>
            <ViewToggle active={view === "grid"} onClick={() => setView("grid")}>
              <LayoutGrid className="size-3.5" /> Grid
            </ViewToggle>
          </div>
          <button
            onClick={() => openProjects()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <FolderGit2 className="size-3.5" /> Projects
          </button>
          <button
            onClick={() => refreshing.now()}
            title="Status refreshes automatically; click to refresh now"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <RefreshCw className={cn("size-3.5", refreshing.pending && "animate-spin")} />
            {deploying ? "Deploying…" : "Refresh"}
          </button>
          <QuickDeployMenu projects={projects} onDeployed={onDeployed} open={newServiceOpen} initialSection={newServiceKind} onOpenChange={(open) => {
            setNewServiceOpen(open);
            if (!open) setNewServiceKind(undefined);
          }} />
        </div>
      </header>

      <ContextMenu label="Add New Service" heading="Add New Service" background items={workspaceMenuItems().map((item) => ({ ...item, onSelect: () => openCreate(item.id) }))}>
        {(trigger) => (
        <section {...trigger} aria-label="Workspace" className="min-h-64 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">
      {services.length === 0 ? (
        <EmptyState projects={projects} onDeployed={onDeployed} />
      ) : view === "canvas" ? (
        <FlowCanvas services={services} edges={edges} onSelect={openService} highlightedId={highlightedId} onHighlight={setHighlightedId} />
      ) : (
        <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {services.map((s) => (
              <ServiceCard key={`${s.kind}:${s.id}`} service={s} selected={highlightedId === s.id} onSelect={() => setHighlightedId(s.id)} onOpen={(section) => openService(s, section)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
        </section>
        )}
      </ContextMenu>

      <ServiceDrawer service={selected} services={services} initialTab={selectedSection} navigationVersion={navigationVersion} onClose={() => setSelectedId(null)} />
      <ProjectsPanel open={projectsOpen} onClose={() => setProjectsOpen(false)} projects={projects} initialProjectId={initialProjectId} />
      <AgentPanel />
    </div>
    </MotionConfig>
  );
}

/** Poll cadence: tight while a deploy is in flight, brisk with a drawer open. */
const DEPLOYING_POLL_MS = 3_000;
const DRAWER_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;

/**
 * Keep server-rendered workspace state (statuses, deploy history, runtime
 * truth) fresh by re-running the page's server fetch on an interval. Paused
 * while the tab is hidden, caught up as soon as it's visible again, and never
 * stacked — a slow refresh just delays the next one.
 */
function useAutoRefresh(intervalMs: number) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Re-armed after every refresh settles, so the gap is measured from the
    // last completed fetch.
    if (pending) return;
    const tick = () => {
      if (!document.hidden) startTransition(() => router.refresh());
    };
    const timer = setTimeout(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, pending, router]);

  return { pending, now: () => startTransition(() => router.refresh()) };
}

function ViewToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-[var(--color-surface-hover)] text-[var(--color-fg)]"
          : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({
  projects,
  onDeployed,
}: {
  projects: ProjectNode[];
  onDeployed: (id: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-strong)] py-20 text-center"
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
        <Boxes className="size-7" />
      </div>
      <h2 className="mt-4 font-medium">No services yet</h2>
      <p className="mb-5 mt-1 max-w-sm text-sm text-[var(--color-fg-muted)]">
        Deploy an app from a Docker image, or spin up a managed database in one click.
      </p>
      <QuickDeployMenu projects={projects} onDeployed={onDeployed} />
    </motion.div>
  );
}
