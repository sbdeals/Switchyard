"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Database as DatabaseIcon, RefreshCw, Network, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Database, ProjectNode, ServiceEdge } from "@/lib/dokploy";
import { DatabaseCard } from "@/components/DatabaseCard";
import { QuickDeployMenu } from "@/components/QuickDeployMenu";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { ServiceDrawer } from "@/components/service/ServiceDrawer";
import { cn } from "@/lib/utils";

type View = "canvas" | "grid";

export function Workspace({
  databases,
  projects,
  edges,
}: {
  databases: Database[];
  projects: ProjectNode[];
  edges: ServiceEdge[];
}) {
  const [view, setView] = useState<View>("canvas");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const router = useRouter();

  // Re-resolve the selected db from fresh props so the drawer reflects updates.
  const selected = databases.find((d) => d.id === selectedId) ?? null;

  // Open the new service's drawer and pull fresh state in.
  const onDeployed = (id: string) => {
    setSelectedId(id);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
              <DatabaseIcon className="size-4.5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Databases</h1>
          </div>
          <p className="mt-1.5 text-sm text-[var(--color-fg-muted)]">
            Managed databases across your Dokploy projects.
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
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </button>
          <QuickDeployMenu projects={projects} onDeployed={onDeployed} />
        </div>
      </header>

      {databases.length === 0 ? (
        <EmptyState projects={projects} onDeployed={onDeployed} />
      ) : view === "canvas" ? (
        <FlowCanvas databases={databases} edges={edges} onSelect={(db) => setSelectedId(db.id)} />
      ) : (
        <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {databases.map((db) => (
              <DatabaseCard
                key={`${db.engine}:${db.id}`}
                db={db}
                onOpen={() => setSelectedId(db.id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <ServiceDrawer db={selected} onClose={() => setSelectedId(null)} />
    </div>
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
      onClick={onClick}
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
        <DatabaseIcon className="size-7" />
      </div>
      <h3 className="mt-4 font-medium">No databases yet</h3>
      <p className="mb-5 mt-1 max-w-sm text-sm text-[var(--color-fg-muted)]">
        Spin up a Postgres, MySQL, MariaDB, MongoDB, or Redis instance in one click.
      </p>
      <QuickDeployMenu projects={projects} onDeployed={onDeployed} />
    </motion.div>
  );
}
