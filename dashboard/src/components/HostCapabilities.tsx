"use client";

import { createContext, useContext, useId } from "react";
import { Info, TriangleAlert } from "lucide-react";
import {
  featureUnavailableReason,
  type HostCapabilities,
  type HostFeature,
} from "@/lib/host-capabilities";

const HostContext = createContext<HostCapabilities>({ mode: "unknown", dokployVersion: null });

export function HostCapabilitiesProvider({
  capabilities,
  children,
}: {
  capabilities: HostCapabilities;
  children?: React.ReactNode;
}) {
  return <HostContext.Provider value={capabilities}>{children}</HostContext.Provider>;
}

export function useHostCapabilities() {
  return useContext(HostContext);
}

export function FeatureNotice({ feature }: { feature: HostFeature }) {
  const host = useHostCapabilities();
  const reason = host.mode === "unknown" && feature !== "compose"
    ? "Docker Swarm availability could not be verified. Actions remain enabled."
    : featureUnavailableReason(host, feature);
  if (!reason) return null;
  return (
    <p role="note" className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-fg-muted)]">
      {reason}
    </p>
  );
}

const features: { key: HostFeature; label: string }[] = [
  { key: "compose", label: "Docker Compose + templates" },
  { key: "nativeApplication", label: "Native Application deploys" },
  { key: "replicas", label: "Replicas" },
  { key: "swarmHealthcheck", label: "Swarm healthchecks" },
  { key: "schedules", label: "Application schedules" },
  { key: "s3Backups", label: "Native database S3 backups" },
];

export function HostCapabilitiesPill() {
  const host = useHostCapabilities();
  const id = useId();
  const label = {
    bridge: "bridge mode",
    swarm: "Swarm",
    worker: "Swarm worker",
    unknown: "unknown",
  }[host.mode];

  return (
    <details
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-controls={id} className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]">
        {host.mode === "unknown" ? <TriangleAlert className="size-3 text-[var(--color-warn)]" /> : <Info className="size-3" />} Host: {label}
      </summary>
      <div id={id} role="region" aria-label="Host capabilities" className="absolute left-0 top-full z-40 mt-2 w-80 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-4 text-xs shadow-2xl">
        <p className="font-medium">Dokploy {host.dokployVersion ?? "version unavailable"}</p>
        <p className="mt-1 text-[var(--color-fg-muted)]">
          {host.mode === "unknown"
            ? "Docker mode could not be read. Swarm support is unverified; actions remain enabled."
            : host.mode === "worker"
              ? "This Docker engine is a Swarm worker. Native features require a Swarm manager."
              : host.mode === "swarm"
                ? "This Docker engine is a Swarm manager."
                : "Compose runs on this host. Native features require a Docker Swarm manager."}
        </p>
        <ul className="mt-3 space-y-2">
          {features.map(({ key, label }) => (
            <li key={key} className="flex justify-between gap-3">
              <span>{label}</span>
              <span className="shrink-0 text-[var(--color-fg-muted)]">
                {host.mode === "unknown" && key !== "compose"
                  ? "Unverified"
                  : featureUnavailableReason(host, key) ? "Needs Swarm" : "Supported"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
