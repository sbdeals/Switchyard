"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Activity, Boxes, RefreshCw, Network, LayoutGrid, FolderGit2, ScrollText } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Service, ProjectNode, ServiceEdge } from "@/lib/dokploy";
import { ServiceCard } from "@/components/ServiceCard";
import { QuickDeployMenu } from "@/components/QuickDeployMenu";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { ActivityPanel } from "@/components/ActivityPanel";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { ServiceDrawer } from "@/components/service/ServiceDrawer";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { GettingStarted } from "@/components/GettingStarted";
import { getWorkspaceScope, type OnboardingItem } from "@/lib/onboarding";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { ProjectLogs } from "@/components/ProjectLogs";
import { useServiceDeeplink } from "@/components/use-service-deeplink";
import { DirtyGuardProvider } from "@/components/DirtyGuard";
import { cn } from "@/lib/utils";

type View = "canvas" | "grid" | "logs";

type WorkspaceProps = {
  services: Service[];
  projects: ProjectNode[];
  edges: ServiceEdge[];
  userId: string | null;
};

export function Workspace(props: WorkspaceProps) {
  return <DirtyGuardProvider><WorkspaceContent {...props} /></DirtyGuardProvider>;
}

function WorkspaceContent({
  services,
  projects,
  edges,
  userId,
}: WorkspaceProps) {
  const [view, setView] = useState<View>("canvas");
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const router = useRouter();
  const drawer = useServiceDeeplink(services);
  const { onDeployed } = drawer;
  const scope = getWorkspaceScope(projects, services, edges, projectId);

  // Refresh deploy results so the checklist follows an in-flight first deploy.
  const deploying = services.some((service) => service.status === "running");
  useEffect(() => {
    if (!deploying) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [deploying, router]);

  const navigateChecklist = (item: OnboardingItem) => {
    if (item.id === "project" || item.id === "environment") {
      setProjectsOpen(true);
    } else if (item.serviceId) {
      drawer.open(item.serviceId, item.id === "domain" ? "domains" : item.id === "variable" ? "variables" : "overview");
    } else {
      setDeployOpen(true);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-16 sm:px-6 sm:pt-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
              <Boxes className="size-4.5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Services</h1>
          </div>
          <p className="mt-1.5 text-sm text-[var(--color-fg-muted)]">
            Apps and databases across your Dokploy projects.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 0 && (
            <select
              aria-label="Filter by project"
              value={scope.project?.projectId ?? ""}
              onChange={(event) => setProjectId(event.target.value || null)}
              className="max-w-48 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
            >
              <option value="">All projects</option>
              {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
            </select>
          )}
          <div className="flex rounded-lg border border-[var(--color-border-strong)] p-0.5">
            <ViewToggle active={view === "canvas"} onClick={() => setView("canvas")}>
              <Network className="size-3.5" /> Canvas
            </ViewToggle>
            <ViewToggle active={view === "grid"} onClick={() => setView("grid")}>
              <LayoutGrid className="size-3.5" /> Grid
            </ViewToggle>
            <ViewToggle active={view === "logs"} onClick={() => setView("logs")}>
              <ScrollText className="size-3.5" /> Logs
            </ViewToggle>
          </div>
          <button
            onClick={() => setProjectsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <FolderGit2 className="size-3.5" /> Projects
          </button>
          <button
            onClick={() => setActivityOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <Activity className="size-3.5" /> Activity
          </button>
          <button
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </button>
          <KeyboardShortcuts />
          <QuickDeployMenu key={scope.project?.projectId ?? "all"} projects={scope.projects} onDeployed={onDeployed} menuOpen={deployOpen} onMenuOpenChange={setDeployOpen} />
        </div>
      </header>

      {view === "logs" ? (
        <ProjectLogs projects={scope.projects} />
      ) : scope.services.length === 0 ? (
        <EmptyState key={scope.project?.projectId ?? "all"} projects={scope.projects} projectName={scope.project?.name} onDeployed={onDeployed} />
      ) : view === "canvas" ? (
        <PanelErrorBoundary>
          <FlowCanvas key={scope.project?.projectId ?? "all"} services={scope.services} allServices={services} edges={scope.edges} projects={scope.projects} onDeployed={onDeployed} onSelect={(s) => drawer.open(s.id)} />
        </PanelErrorBoundary>
      ) : (
        <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {scope.services.map((s) => (
              <ServiceCard key={`${s.kind}:${s.id}`} service={s} onOpen={() => drawer.open(s.id)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <GettingStarted key={userId} projects={projects} services={services} userId={userId} onNavigate={navigateChecklist} />
      <ServiceDrawer services={services} onSelectService={drawer.open} service={drawer.service} tab={drawer.tab} sessionKey={drawer.scope} onTabChange={drawer.selectTab} onClose={drawer.close} />
      {drawer.notFound && (
        <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-4 py-2 text-sm shadow-lg">
          Service not found
        </div>
      )}
      <ProjectsPanel open={projectsOpen} onClose={() => setProjectsOpen(false)} projects={projects} />
      {activityOpen && (
        <ActivityPanel
          projects={projects}
          onClose={() => setActivityOpen(false)}
          onSelect={(entry) => {
            setActivityOpen(false);
            drawer.open(entry.serviceId, "deployments");
            router.refresh();
          }}
        />
      )}
      <AgentPanel />
    </div>
    </MotionConfig>
  );
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
  projectName,
  onDeployed,
}: {
  projects: ProjectNode[];
  projectName?: string;
  onDeployed: (id: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-2xl border border-dashed border-[var(--color-border-strong)] px-5 py-10 text-center sm:px-10 sm:py-14"
    >
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
        <Boxes className="size-7" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">{projectName ? `${projectName} is ready for its first service` : "Bring your first project to life"}</h2>
      <p className="mx-auto mb-7 mt-2 max-w-md text-sm text-[var(--color-fg-muted)]">
        Start with your code, a container image, or a database. We&apos;ll help you get it running.
      </p>
      <QuickDeployMenu variant="cards" projects={projects} onDeployed={onDeployed} />
    </motion.div>
  );
}
