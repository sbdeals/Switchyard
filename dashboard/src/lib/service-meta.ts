import type { Service, ServiceRuntime } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";

/** Brand accent for applications (databases use their engine accent). */
export const APP_ACCENT = "#a06bff";
export const COMPOSE_ACCENT = "#2dd4bf";

export function serviceAccent(s: Service): string {
  if (s.kind === "database") return ENGINE_META[s.engine].accent;
  if (s.kind === "compose") return COMPOSE_ACCENT;
  return APP_ACCENT;
}

/** Human label, e.g. "PostgreSQL" or "Docker image". */
export function serviceLabel(s: Service): string {
  if (s.kind === "database") return ENGINE_META[s.engine].label;
  if (s.kind === "compose") return "Compose";
  switch (s.sourceType) {
    case "docker":
      return "Docker image";
    case "github":
    case "gitlab":
    case "bitbucket":
    case "gitea":
    case "git":
      return "Git app";
    default:
      return "Application";
  }
}

/** Secondary line under the name (image tag, or label). */
export function serviceSubtitle(s: Service): string {
  return s.dockerImage ?? serviceLabel(s);
}

/** Shared shape for status/runtime display metadata. */
export interface StatusDisplay {
  label: string;
  color: string;
  soft: string;
  pulse?: boolean;
  /** Non-nominal — surfaces render a visible text badge, not just a dot. */
  attention?: boolean;
  /** Extra context, e.g. "3/13 containers running". */
  detail?: string;
}

/** Display metadata for each lifecycle status (shared by badge and canvas). */
export const STATUS_META: Record<string, StatusDisplay> = {
  done: { label: "Running", color: "var(--color-ok)", soft: "var(--color-ok-soft)" },
  running: {
    label: "Deploying",
    color: "var(--color-warn)",
    soft: "var(--color-warn-soft)",
    pulse: true,
  },
  error: {
    label: "Error",
    color: "var(--color-danger)",
    soft: "var(--color-danger-soft)",
    attention: true,
  },
  idle: { label: "Idle", color: "var(--color-idle)", soft: "var(--color-idle-soft)" },
};

/** Display metadata for engine truth (see Service.runtime). */
export const RUNTIME_META: Record<ServiceRuntime["health"], StatusDisplay> = {
  running: { label: "Running", color: "var(--color-ok)", soft: "var(--color-ok-soft)" },
  degraded: {
    label: "Degraded",
    color: "var(--color-warn)",
    soft: "var(--color-warn-soft)",
    attention: true,
  },
  "not-running": {
    label: "Not running",
    color: "var(--color-danger)",
    soft: "var(--color-danger-soft)",
    attention: true,
  },
};

/** Deploy-verdict wording for the drawer's "Last deploy" line. */
export const LAST_DEPLOY_LABEL: Record<string, string> = {
  done: "Succeeded",
  running: "In progress",
  error: "Failed",
  idle: "Never deployed",
};

/**
 * What a status indicator should show: engine truth when we have it, deploy
 * lifecycle otherwise. An in-flight deploy ("Deploying") and a never-deployed
 * service ("Idle") win over the runtime sweep — containers legitimately churn
 * during the former and don't exist yet for the latter.
 */
export function resolveServiceDisplay(status: string, runtime?: ServiceRuntime): StatusDisplay {
  if (status === "running" || status === "idle" || !runtime) {
    return STATUS_META[status] ?? STATUS_META.idle;
  }
  const meta = RUNTIME_META[runtime.health];
  if (runtime.health === "running") return meta;
  return { ...meta, detail: `${runtime.running}/${runtime.total} containers running` };
}
