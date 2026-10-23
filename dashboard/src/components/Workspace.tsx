"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Boxes, RefreshCw, Network, LayoutGrid, FolderGit2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Service, ProjectNode, ServiceEdge } from "@/lib/dokploy";
import type { DeployTarget } from "@/lib/deploy-target";
import { ServiceCard } from "@/components/ServiceCard";
import { QuickDeployMenu } from "@/components/QuickDeployMenu";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { ServiceDrawer } from "@/components/service/ServiceDrawer";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { cn } from "@/lib/utils";

type View = "canvas" | "grid";

export function Workspace({
  services,
  projects,
  edges,
  deployTarget,
}: {
  services: Service[];
  projects: ProjectNode[];
  edges: ServiceEdge[];
  deployTarget: DeployTarget;
}) {
  const [view, setView] = useState<View>("canvas");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const router = useRouter();
  const deploying = services.some((s) => s.status === "running");
  const refreshing = useAutoRefresh(
    deploying ? DEPLOYING_POLL_MS : selectedId ? DRAWER_POLL_MS : IDLE_POLL_MS
  );

  // Re-resolve the selected service from fresh props so the drawer updates.
  const selected = services.find((s) => s.id === selectedId) ?? null;

  // Open the new service's drawer and pull fresh state in.
  const onDeployed = (id: string) => {
    setSelectedId(id);
    router.refresh();
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
          <div className="flex rounded-lg border border-[var(--color-border-strong)] p-0.5">
            <ViewToggle active={view === "canvas"} onClick={() => setView("canvas")}>
              <Network className="size-3.5" /> Canvas
            </ViewToggle>
            <ViewToggle active={view === "grid"} onClick={() => setView("grid")}>
              <LayoutGrid className="size-3.5" /> Grid
            </ViewToggle>
          </div>
          <button
            onClick={() => setProjectsOpen(true)}
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
          <QuickDeployMenu projects={projects} deployTarget={deployTarget} onDeployed={onDeployed} />
        </div>
      </header>

      {services.length === 0 ? (
        <EmptyState projects={projects} deployTarget={deployTarget} onDeployed={onDeployed} />
      ) : view === "canvas" ? (
        <FlowCanvas services={services} edges={edges} onSelect={(s) => setSelectedId(s.id)} />
      ) : (
        <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {services.map((s) => (
              <ServiceCard key={`${s.kind}:${s.id}`} service={s} onOpen={() => setSelectedId(s.id)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <ServiceDrawer service={selected} services={services} onClose={() => setSelectedId(null)} />
      <ProjectsPanel open={projectsOpen} onClose={() => setProjectsOpen(false)} projects={projects} />
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
  deployTarget,
  onDeployed,
}: {
  projects: ProjectNode[];
  deployTarget: DeployTarget;
  onDeployed: (id: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-strong)] px-5 py-12 text-center"
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
        <Boxes className="size-7" />
      </div>
      <h2 className="mt-4 font-medium">Deploy your first service</h2>
      <p className="mb-5 mt-1 max-w-sm text-sm text-[var(--color-fg-muted)]">
        Start with your code, a container image, or a managed database. Try a sample to see it live.
      </p>
      <QuickDeployMenu projects={projects} deployTarget={deployTarget} onDeployed={onDeployed} onboarding />
    </motion.div>
  );
}
