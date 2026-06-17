"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Database as DatabaseIcon } from "lucide-react";
import type { Database } from "@/lib/dokploy";
import { ENGINE_META, STATUS_META } from "@/lib/engines";

export interface ServiceNodeData extends Record<string, unknown> {
  db: Database;
  onSelect: (db: Database) => void;
}

function ServiceNodeBase({ data, selected }: NodeProps & { data: ServiceNodeData }) {
  const { db, onSelect } = data;
  const meta = ENGINE_META[db.engine];
  const status = STATUS_META[db.status] ?? STATUS_META.idle;

  return (
    <div
      onClick={() => onSelect(db)}
      className="w-60 cursor-pointer rounded-xl border bg-[var(--color-surface)] p-3 transition-colors hover:bg-[var(--color-surface-hover)]"
      style={{
        borderColor: selected ? meta.accent : "var(--color-border-strong)",
        boxShadow: selected ? `0 0 0 1px ${meta.accent}, 0 8px 30px -12px ${meta.accent}80` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: meta.accent, border: "none" }} />
      <Handle type="source" position={Position.Right} style={{ background: meta.accent, border: "none" }} />

      <div className="flex items-center gap-2.5">
        <div
          className="flex size-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${meta.accent}1a`, color: meta.accent }}
        >
          <DatabaseIcon className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{db.name}</div>
          <div className="truncate text-[11px] text-[var(--color-fg-muted)]">
            {db.dockerImage ?? meta.label}
          </div>
        </div>
        <span
          className={`size-2 shrink-0 rounded-full ${status.pulse ? "animate-pulse" : ""}`}
          style={{ backgroundColor: status.color }}
          title={status.label}
        />
      </div>
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeBase);
