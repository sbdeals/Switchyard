"use client";

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Database as DatabaseIcon, Box, Layers } from "lucide-react";
import type { Service } from "@/lib/dokploy";
import { STATUS_META, serviceAccent, serviceSubtitle } from "@/lib/service-meta";

export interface ServiceNodeData extends Record<string, unknown> {
  service: Service;
  /** Catalog logo URL for the app (Railway-style), or null for the generic icon. */
  logo: string | null;
  onSelect: (service: Service) => void;
}

function ServiceNodeBase({ data, selected }: NodeProps & { data: ServiceNodeData }) {
  const { service, logo, onSelect } = data;
  const accent = serviceAccent(service);
  const status = STATUS_META[service.status] ?? STATUS_META.idle;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${service.name}, ${serviceSubtitle(service)}, ${status.label} — open details`}
      onClick={() => onSelect(service)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(service);
        }
      }}
      className="w-60 cursor-pointer rounded-xl border bg-[var(--color-surface)] p-3 transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
      style={{
        borderColor: selected ? accent : "var(--color-border-strong)",
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 8px 30px -12px ${accent}80` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: accent, border: "none" }} />
      <Handle type="source" position={Position.Right} style={{ background: accent, border: "none" }} />

      <div className="flex items-center gap-2.5">
        <ServiceLogo service={service} logo={logo} accent={accent} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{service.name}</div>
          <div className="truncate text-[11px] text-[var(--color-fg-muted)]">
            {serviceSubtitle(service)}
          </div>
          <div className="truncate text-[10px] text-[var(--color-fg-subtle)]">
            {service.projectName} / {service.environmentName}
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

/**
 * The app's catalog logo, falling back to the kind icon when there is no match
 * or the CDN asset is missing (it soft-404s to HTML, which <img> treats as a
 * broken image — onError swaps the icon back in).
 */
export function ServiceLogo({
  service,
  logo,
  accent,
  size = "size-9",
}: {
  service: Service;
  logo: string | null;
  accent: string;
  size?: string;
}) {
  const [failed, setFailed] = useState(false);
  const Icon =
    service.kind === "database" ? DatabaseIcon : service.kind === "compose" ? Layers : Box;
  return (
    <div
      className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-lg`}
      style={{ backgroundColor: `${accent}1a`, color: accent }}
    >
      {logo && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote catalog logos from arbitrary hosts
        <img
          src={logo}
          alt=""
          className="size-[70%] object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="size-[50%]" />
      )}
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeBase);
