"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Boxes, RefreshCw, Network, LayoutGrid, FolderGit2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Service, ProjectNode, ServiceEdge } from "@/lib/dokploy";
import { ServiceCard } from "@/components/ServiceCard";
import { BulkActionDialog } from "@/components/BulkActionDialog";
import { QuickDeployMenu } from "@/components/QuickDeployMenu";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { ServiceDrawer } from "@/components/service/ServiceDrawer";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { cn } from "@/lib/utils";
import { emptySelection, reconcileSelection, replaceSelection, toggleSelection } from "@/lib/bulk-selection";
import { BULK_ACTION_LABELS, type BulkAction } from "@/lib/bulk-actions";

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
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [bulkSelection, setBulkSelection] = useState(emptySelection);
  const [bulkRequest, setBulkRequest] = useState<{ action: BulkAction; services: Service[] } | null>(null);
  const serviceIds = useMemo(() => services.map((service) => service.id), [services]);
  const selection = useMemo(() => reconcileSelection(bulkSelection, serviceIds), [bulkSelection, serviceIds]);
  if (selection.ids.length !== bulkSelection.ids.length || selection.anchor !== bulkSelection.anchor) {
    setBulkSelection(selection);
  }
  const selectedServices = services.filter((service) => selection.ids.includes(service.id));
  const onCanvasSelection = useCallback((ids: string[]) => {
    setBulkSelection((current) => replaceSelection(current, serviceIds, ids));
  }, [serviceIds]);
  const openService = useCallback((service: Service) => setSelectedId(service.id), []);
  const router = useRouter();

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
            Apps and databases across your Dokploy projects.
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
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </button>
          <QuickDeployMenu projects={projects} onDeployed={onDeployed} />
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

      {services.length === 0 ? (
        <EmptyState projects={projects} onDeployed={onDeployed} />
      ) : view === "canvas" ? (
        <FlowCanvas services={services} edges={edges} onSelect={openService} selectedIds={selection.ids} onSelectionChange={onCanvasSelection} selectionDisabled={bulkRequest !== null} />
      ) : (
        <>
        <p className="mb-3 text-xs text-[var(--color-fg-subtle)]">Select services with the checkboxes. Shift-click to select a range.</p>
        <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {services.map((s) => (
              <ServiceCard
                key={`${s.kind}:${s.id}`}
                service={s}
                onOpen={() => setSelectedId(s.id)}
                selected={selection.ids.includes(s.id)}
                selectionDisabled={bulkRequest !== null}
                onToggleSelection={(shift) => setBulkSelection((current) => toggleSelection(current, serviceIds, s.id, shift))}
              />
            ))}
          </AnimatePresence>
        </motion.div>
        </>
      )}

      {bulkRequest && <BulkActionDialog {...bulkRequest} onClose={() => setBulkRequest(null)} />}
      <ServiceDrawer service={selected} onClose={() => setSelectedId(null)} />
      <ProjectsPanel open={projectsOpen} onClose={() => setProjectsOpen(false)} projects={projects} />
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
