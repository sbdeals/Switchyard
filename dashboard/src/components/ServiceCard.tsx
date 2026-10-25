"use client";

import { motion } from "framer-motion";
import { Rocket, ChevronRight, ExternalLink } from "lucide-react";
import type { Service } from "@/lib/dokploy";
import { serviceAccent, serviceSubtitle } from "@/lib/service-meta";
import { resolveServiceLogo, useTemplateLogos } from "@/lib/service-logo";
import { ServiceLogo } from "@/components/canvas/ServiceNode";
import { StatusBadge } from "@/components/StatusBadge";
import { ServiceContextMenu, type ServiceSection } from "@/components/service/ServiceContextMenu";

/**
 * Compact card: identity + status at a glance, click to open the drawer where
 * all config, lifecycle, logs and metrics live. A one-click Deploy shows inline
 * only when the service hasn't been deployed yet.
 */
export function ServiceCard({ service, onOpen, selected, onSelect }: {
  service: Service;
  onOpen: (section?: ServiceSection) => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const accent = serviceAccent(service);
  const domains = service.kind === "application" ||
    (service.kind === "compose" && (service.managed?.kind === "image" || service.managed?.kind === "repo")) ? service.domains : [];
  const publicDomain = domains.find((d) => d.https) ?? domains[0];
  const logos = useTemplateLogos();

  return (
    <ServiceContextMenu service={service} onOpen={onOpen} onSelect={onSelect}>
      {(trigger, deploy, pending, error) => (
    <motion.div
      {...trigger}
      tabIndex={-1}
      data-selected={selected}
      style={selected ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}` } : undefined}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="group relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div className="flex items-center gap-3">
        <ServiceLogo
          service={service}
          logo={resolveServiceLogo(service, logos)}
          accent={accent}
          size="size-10"
        />
        <div className="min-w-0 flex-1">
          {/* Stretched button: the whole card is the click/keyboard target,
              while Deploy below stays independently operable (z-10). */}
          <button
            type="button"
            onClick={() => onOpen()}
            className="block w-full cursor-pointer truncate text-left font-medium leading-tight after:absolute after:inset-0 after:cursor-pointer after:content-['']"
          >
            {service.name}
            <span className="sr-only">, open service details</span>
          </button>
          <div className="truncate text-xs text-[var(--color-fg-muted)]">
            {serviceSubtitle(service)}
          </div>
        </div>
        <StatusBadge status={service.status} />
      </div>

      {publicDomain && (
        <a
          href={`${publicDomain.https ? "https" : "http"}://${publicDomain.host}`}
          target="_blank"
          rel="noreferrer"
          className="relative z-10 mt-3 flex items-center gap-1.5 text-xs text-[var(--color-brand)] hover:underline"
        >
          <span className="truncate">{publicDomain.host}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="truncate text-xs text-[var(--color-fg-subtle)]">
          {service.projectName} / {service.environmentName}
        </span>
        {service.status === "idle" ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); deploy(); }}
            disabled={pending}
            className="relative z-10 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
          >
            <Rocket className="size-3.5" /> Deploy
          </button>
        ) : (
          <ChevronRight className="size-4 text-[var(--color-fg-subtle)] transition-transform group-hover:translate-x-0.5" />
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </motion.div>
      )}
    </ServiceContextMenu>
  );
}
