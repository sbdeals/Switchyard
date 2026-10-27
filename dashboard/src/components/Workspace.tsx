"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Activity, Boxes, RefreshCw, Network, LayoutGrid, FolderGit2, Search, ScrollText } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Service, ProjectNode, ServiceEdge } from "@/lib/dokploy";
import { ServiceCard } from "@/components/ServiceCard";
import { BulkActionDialog } from "@/components/BulkActionDialog";
import { QuickDeployMenu } from "@/components/QuickDeployMenu";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { ActivityPanel } from "@/components/ActivityPanel";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { ServiceDrawer } from "@/components/service/ServiceDrawer";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { ProjectLogs } from "@/components/ProjectLogs";
import { useServiceDeeplink } from "@/components/use-service-deeplink";
import { DeployNotifications } from "@/components/DeployNotifications";
import { useWorkspacePolling } from "@/components/use-workspace-polling";
import type { DeploymentEvent } from "@/lib/deploy-notifications";
import { DirtyGuardProvider, useGuardedNavigation } from "@/components/DirtyGuard";
import { cn } from "@/lib/utils";
import {
  SERVICE_FILTERS,
  filterServices,
  readServiceFilter,
  serviceFilterShortcut,
  serviceFilterUrl,
  type ServiceFilter,
} from "@/lib/service-filter";
import { emptySelection, reconcileSelection, replaceSelection, toggleSelection } from "@/lib/bulk-selection";
import { BULK_ACTION_LABELS, type BulkAction } from "@/lib/bulk-actions";

type View = "canvas" | "grid" | "logs";

type WorkspaceProps = {
  services: Service[];
  projects: ProjectNode[];
  edges: ServiceEdge[];
  notificationScope: string;
};

export function Workspace(props: WorkspaceProps) {
  return <DirtyGuardProvider><WorkspaceContent {...props} /></DirtyGuardProvider>;
}

function WorkspaceContent({
  services: initialServices,
  projects: initialProjects,
  edges: initialEdges,
  notificationScope,
}: WorkspaceProps) {
  const [view, setView] = useState<View>("canvas");
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<DeploymentEvent | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const router = useRouter();
  const { services, projects, edges } = useWorkspacePolling({
    services: initialServices,
    projects: initialProjects,
    edges: initialEdges,
  }, projectId);
  const currentProject = projects.some((p) => p.projectId === projectId) ? projectId : null;
  const visibleServices = currentProject ? services.filter((s) => s.projectId === currentProject) : services;
  const searchParams = useSearchParams();
  const params = searchParams.toString();
  const [previousParams, setPreviousParams] = useState(params);
  const [filter, setFilter] = useState(() => readServiceFilter(searchParams));
  // Keep typing synchronous (including the caret), while accepting URL changes
  // from reloads and browser navigation. History updates use a React transition.
  if (params !== previousParams) {
    setPreviousParams(params);
    setFilter(readServiceFilter(searchParams));
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const { matches, counts } = filterServices(visibleServices, filter);
  const matchingIds = new Set(matches.map((service) => service.id));
  const updateFilter = useCallback((next: ServiceFilter) => {
    setFilter(next);
    window.history.replaceState(null, "", serviceFilterUrl(window.location.href, next));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = serviceFilterShortcut(event, {
        editable: !!target?.closest("input, textarea, select, [role='textbox']") || !!target?.isContentEditable,
        overlayOpen: !!document.querySelector("[role='dialog'], [aria-modal='true'], [role='menu'], [role='combobox'][aria-expanded='true']"),
        searchFocused: target === searchRef.current,
      });
      if (!action) return;
      event.preventDefault();
      if (action === "focus") searchRef.current?.focus();
      else updateFilter({ ...readServiceFilter(new URLSearchParams(window.location.search)), q: "" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [updateFilter]);

  const drawer = useServiceDeeplink(services);
  const { navigate } = useGuardedNavigation();
  const openService = (id: string) => navigate(() => {
    setDeployment(null);
    drawer.open(id);
  }, drawer.service?.id === id && drawer.tab === "overview");
  const { onDeployed } = drawer;
  const [bulkSelection, setBulkSelection] = useState(emptySelection);
  const [bulkRequest, setBulkRequest] = useState<{ action: BulkAction; services: Service[] } | null>(null);
  const serviceIds = useMemo(() => visibleServices.map((service) => service.id), [visibleServices]);
  const selection = useMemo(() => reconcileSelection(bulkSelection, serviceIds), [bulkSelection, serviceIds]);
  if (selection.ids.length !== bulkSelection.ids.length || selection.anchor !== bulkSelection.anchor) {
    setBulkSelection(selection);
  }
  const selectedServices = visibleServices.filter((service) => selection.ids.includes(service.id));
  const onCanvasSelection = useCallback((ids: string[]) => {
    setBulkSelection((current) => replaceSelection(current, serviceIds, ids));
  }, [serviceIds]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="mx-auto max-w-7xl px-6 pb-8 pt-20 sm:pt-8">
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
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <select
            aria-label="Current project"
            value={currentProject ?? ""}
            onChange={(e) => {
              const nextProject = e.target.value || null;
              navigate(() => {
                setProjectId(nextProject);
                setDeployment(null);
                drawer.close();
              });
            }}
            className="max-w-40 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2 py-2 text-xs"
          >
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
          </select>
          <DeployNotifications
            key={notificationScope}
            services={services}
            projectId={currentProject}
            storageKey={`switchyard:deploy-activity:v1:${notificationScope}`}
            onViewLogs={(event) => navigate(() => {
              setDeployment(event);
              drawer.open(event.serviceId, "logs");
            })}
          />
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
          <QuickDeployMenu projects={projects} onDeployed={onDeployed} />
        </div>
        <div className="flex w-full flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 size-4 text-[var(--color-fg-subtle)]" />
            <input
              ref={searchRef}
              type="search"
              aria-label="Search services"
              aria-describedby="service-search-hint"
              aria-keyshortcuts="/ Escape"
              placeholder="Search services…"
              value={filter.q}
              onChange={(event) => updateFilter({ ...filter, q: event.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)]"
            />
          </div>
          <span id="service-search-hint" className="text-xs text-[var(--color-fg-subtle)]">
            / to search · Esc to clear
          </span>
          <div role="group" aria-label="Filter services by status" className="flex flex-wrap gap-1.5">
            {SERVICE_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter.status === value}
                onClick={() => updateFilter({ ...filter, status: value })}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  filter.status === value
                    ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                    : "border-[var(--color-border-strong)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                )}
              >
                {label} <span className="tabular-nums">{counts[value]}</span>
              </button>
            ))}
          </div>
          <span role="status" className="text-xs text-[var(--color-fg-muted)]">
            {matches.length} of {visibleServices.length} services
          </span>
        </div>
      </header>

      {selection.ids.length > 0 && (
        <div role="region" aria-label="Bulk service actions" className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-3 shadow-lg">
          <span className="mr-auto text-sm font-medium">{selection.ids.length} selected</span>
          {(Object.keys(BULK_ACTION_LABELS) as BulkAction[]).map((action) => (
            <button
              key={action}
              type="button"
              disabled={bulkRequest !== null}
              onClick={() => setBulkRequest({ action, services: selectedServices })}
              className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
            >
              {BULK_ACTION_LABELS[action]}
            </button>
          ))}
          <button type="button" disabled={bulkRequest !== null} onClick={() => setBulkSelection(emptySelection)} className="px-2 py-1.5 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-40">
            Clear selection
          </button>
        </div>
      )}

      <div className="relative">
        {view !== "logs" && visibleServices.length > 0 && matches.length === 0 && (
          <div className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5",
            view === "canvas" ? "absolute inset-x-4 top-4 z-10" : "mb-4"
          )}>
            <div>
              <h2 className="text-sm font-medium">No services match your filters</h2>
              <p className="mt-1 text-xs text-[var(--color-fg-muted)]">Try another search or status.</p>
            </div>
            <button
              type="button"
              onClick={() => updateFilter({ q: "", status: "all" })}
              className="rounded-lg bg-[var(--color-brand-soft)] px-3 py-2 text-xs font-medium text-[var(--color-brand)] hover:bg-[var(--color-surface-hover)]"
            >
              Clear filters
            </button>
          </div>
        )}

        {view === "logs" ? (
          <ProjectLogs key={currentProject ?? "all"} projects={projects} selectedProjectId={currentProject} />
        ) : visibleServices.length === 0 ? (
          <EmptyState projects={projects} onDeployed={onDeployed} />
        ) : view === "canvas" ? (
          <PanelErrorBoundary>
            <FlowCanvas services={visibleServices} edges={edges.filter((e) => visibleServices.some((s) => s.id === e.source) && visibleServices.some((s) => s.id === e.target))} matchingIds={matchingIds} projects={projects} onDeployed={onDeployed} onSelect={(s) => openService(s.id)} selectedIds={selection.ids} onSelectionChange={onCanvasSelection} selectionDisabled={bulkRequest !== null} />
          </PanelErrorBoundary>
        ) : (
          <>
          {matches.length > 0 && <p className="mb-3 text-xs text-[var(--color-fg-subtle)]">Select services with the checkboxes. Shift-click to select a range.</p>}
          <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {matches.map((s) => (
                <ServiceCard
                  key={`${s.kind}:${s.id}`}
                  service={s}
                  onOpen={() => openService(s.id)}
                  selected={selection.ids.includes(s.id)}
                  selectionDisabled={bulkRequest !== null}
                  onToggleSelection={(shift) => setBulkSelection((current) => toggleSelection(current, matches.map((match) => match.id), s.id, shift))}
                />
              ))}
            </AnimatePresence>
          </motion.div>
          </>
        )}
      </div>

      {bulkRequest && <BulkActionDialog {...bulkRequest} onClose={() => setBulkRequest(null)} />}
      <ServiceDrawer deploymentId={deployment?.serviceId === drawer.service?.id ? deployment?.deploymentId : undefined} services={services} onSelectService={openService} service={drawer.service} tab={drawer.tab} sessionKey={drawer.scope} onTabChange={drawer.selectTab} onClose={drawer.close} />
      {drawer.notFound && (
        <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-4 py-2 text-sm shadow-lg">
          Service not found
        </div>
      )}
      <ProjectsPanel open={projectsOpen} onClose={() => setProjectsOpen(false)} projects={projects} services={services} />
      {activityOpen && (
        <ActivityPanel
          projects={projects}
          onClose={() => setActivityOpen(false)}
          onSelect={(entry) => navigate(() => {
            setActivityOpen(false);
            setDeployment(null);
            drawer.open(entry.serviceId, "deployments");
            router.refresh();
          })}
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
  onDeployed,
}: {
  projects: ProjectNode[];
  onDeployed: (id: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex min-w-0 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-strong)] px-4 py-20 text-center sm:px-0"
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
        <Boxes className="size-7" />
      </div>
      <h2 className="mt-4 font-medium">No services yet</h2>
      <p className="mb-5 mt-1 w-full max-w-sm text-sm text-[var(--color-fg-muted)]">
        Deploy an app from a Docker image, or spin up a managed database in one click.
      </p>
      <QuickDeployMenu projects={projects} onDeployed={onDeployed} />
    </motion.div>
  );
}
