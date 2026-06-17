"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Database as DatabaseIcon, RefreshCw, Network, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Database, ProjectNode, ServiceEdge } from "@/lib/dokploy";
import { DatabaseCard } from "@/components/DatabaseCard";
import { NewDatabaseDialog } from "@/components/NewDatabaseDialog";
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const router = useRouter();

  // Re-resolve the selected db from fresh props so the drawer reflects updates.
  const selected = databases.find((d) => d.id === selectedId) ?? null;

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
          <button
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)]"
          >
            <Plus className="size-4" /> New database
          </button>
        </div>
      </header>

      {databases.length === 0 ? (
        <EmptyState onCreate={() => setDialogOpen(true)} />
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
      <NewDatabaseDialog open={dialogOpen} onClose={() => setDialogOpen(false)} projects={projects} />
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

function EmptyState({ onCreate }: { onCreate: () => void }) {
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
      <p className="mt-1 max-w-sm text-sm text-[var(--color-fg-muted)]">
        Spin up a Postgres, MySQL, MariaDB, MongoDB, or Redis instance in seconds.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)]"
      >
        <Plus className="size-4" /> Create your first database
      </button>
    </motion.div>
  );
}
