"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Database as DatabaseIcon, Box, Layers } from "lucide-react";
import type { Service } from "@/lib/dokploy";
import { STATUS_META, serviceAccent, serviceSubtitle } from "@/lib/service-meta";

export interface ServiceNodeData extends Record<string, unknown> {
  service: Service;
  onSelect: (service: Service) => void;
}

function ServiceNodeBase({ data, selected }: NodeProps & { data: ServiceNodeData }) {
  const { service, onSelect } = data;
  const accent = serviceAccent(service);
  const status = STATUS_META[service.status] ?? STATUS_META.idle;
  const Icon =
    service.kind === "database" ? DatabaseIcon : service.kind === "compose" ? Layers : Box;

  return (
    <div
      onClick={() => onSelect(service)}
      className="w-60 cursor-pointer rounded-xl border bg-[var(--color-surface)] p-3 transition-colors hover:bg-[var(--color-surface-hover)]"
      style={{
        borderColor: selected ? accent : "var(--color-border-strong)",
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 8px 30px -12px ${accent}80` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: accent, border: "none" }} />
      <Handle type="source" position={Position.Right} style={{ background: accent, border: "none" }} />

      <div className="flex items-center gap-2.5">
        <div
          className="flex size-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${accent}1a`, color: accent }}
        >
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{service.name}</div>
          <div className="truncate text-[11px] text-[var(--color-fg-muted)]">
            {serviceSubtitle(service)}
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
