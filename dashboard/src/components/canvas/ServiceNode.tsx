"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Service } from "@/lib/dokploy";
import { hasSelectionModifier } from "@/lib/bulk-selection";
import { resolveServiceDisplay, serviceAccent, serviceSubtitle } from "@/lib/service-meta";
import { serviceNotesSubtitle } from "@/lib/service-notes";
import { SHORTCUTS } from "@/lib/shortcuts";
import { resolveServiceIcon } from "@/lib/service-icon";
import { ServiceIcon } from "@/components/ServiceIcon";

export interface ServiceNodeData extends Record<string, unknown> {
  service: Service;
  /** Exact catalog logo match, or null to use the local badge. */
  logo: string | null;
  onSelect: (service: Service) => void;
}

function ServiceNodeBase({ data, selected }: NodeProps & { data: ServiceNodeData }) {
  const { service, logo, onSelect } = data;
  const accent = serviceAccent(service);
  const status = resolveServiceDisplay(service.status, service.runtime);
  const notesSubtitle = serviceNotesSubtitle(service.description);

  // React Flow's nokey class lets Shift-click select a node; Shift-drag on the
  // surrounding canvas still starts the selection rectangle.
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${service.name}, ${serviceSubtitle(service)}, ${status.label}${status.detail ? ` (${status.detail})` : ""} — open details`}
      onClick={(e) => {
        if (!hasSelectionModifier(e)) onSelect(service);
      }}
      onKeyDown={(e) => {
        if (SHORTCUTS.openService.keys.some((key) => key === e.key)) {
          e.preventDefault();
          if (!hasSelectionModifier(e)) onSelect(service);
        }
      }}
      className="nokey w-60 cursor-pointer rounded-xl border bg-[var(--color-surface)] p-3 transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
      style={{
        borderColor: selected ? accent : "var(--color-border-strong)",
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 8px 30px -12px color-mix(in srgb, ${accent} 50%, transparent)` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: accent, border: "none" }} />
      <Handle type="source" position={Position.Right} style={{ background: accent, border: "none" }} />

      <div className="flex items-center gap-2.5">
        <ServiceLogo service={service} logo={logo} accent={accent} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{service.name}</div>
          <div
            title={notesSubtitle ? service.description ?? undefined : undefined}
            className="truncate text-[11px] text-[var(--color-fg-muted)]"
          >
            {notesSubtitle || serviceSubtitle(service)}
          </div>
          <div className="truncate text-[10px] text-[var(--color-fg-subtle)]">
            {service.projectName} / {service.environmentName}
          </div>
        </div>
        {status.attention ? (
          // Engine truth demands attention — a visible text badge, not just a
          // colored dot (WCAG: never color alone for state).
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: status.soft, color: status.color }}
            title={status.detail ?? status.label}
          >
            {status.label}
          </span>
        ) : (
          <span
            className={`size-2 shrink-0 rounded-full ${status.pulse ? "animate-pulse" : ""}`}
            style={{ backgroundColor: status.color }}
            title={status.label}
          />
        )}
      </div>
    </div>
  );
}

/** Shared catalog-first service identity, with local SVG and generic fallbacks. */
export function ServiceLogo({
  service,
  logo,
  accent,
  size = "size-9",
  rounded = "rounded-lg",
}: {
  service: Service;
  logo: string | null;
  accent: string;
  size?: string;
  rounded?: string;
}) {
  return (
    <ServiceIcon
      icon={resolveServiceIcon(service)}
      logo={logo}
      logoLabel={service.name}
      accent={accent}
      size={size}
      rounded={rounded}
    />
  );
}

export const ServiceNode = memo(ServiceNodeBase);
