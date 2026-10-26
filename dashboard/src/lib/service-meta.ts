import type { Service, ServiceRuntime } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
import { explainDeployError } from "@/lib/deploy-errors";

/** Brand accent for applications (databases use their engine accent). */
export const APP_ACCENT = "#a06bff";
export const COMPOSE_ACCENT = "#2dd4bf";

export function serviceAccent(s: Service): string {
  if (s.kind === "database") return ENGINE_META[s.engine].accent;
  if (s.kind === "compose") {
    if (s.managed?.kind === "database") return ENGINE_META[s.managed.engine].accent;
    return s.managed ? APP_ACCENT : COMPOSE_ACCENT;
  }
  return APP_ACCENT;
}

/** Human label, e.g. "PostgreSQL" or "Docker image". */
export function serviceLabel(s: Service): string {
  if (s.kind === "database") return ENGINE_META[s.engine].label;
  if (s.kind === "compose") {
    if (s.managed?.kind === "database") return ENGINE_META[s.managed.engine].label;
    if (s.managed?.kind === "repo") {
      return /^https?:\/\/github\.com(?:\/|:|$)/i.test(s.managed.repoUrl) ? "GitHub repo" : "Git repo";
    }
    return s.managed?.kind === "image" ? "Docker image" : "Compose";
  }
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

/**
 * The kind a service should LOOK like: a Switchyard-managed compose stack
 * reads as the database or app it runs, not as a raw stack.
 */
export function presentedKind(s: Service): "database" | "application" | "compose" {
  if (s.kind === "compose" && s.managed) return s.managed.kind === "database" ? "database" : "application";
  return s.kind;
}

/** Secondary line under the name (image tag, or label). */
export function serviceSubtitle(s: Service): string {
  if (s.kind === "compose" && s.managed?.kind === "repo") {
    if (s.managed.preview) return `PR #${s.managed.preview.number} · ${s.managed.branch}`;
    return `${serviceLabel(s)} · ${s.managed.branch}`;
  }
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
  /** Longer explanation for tooltips (e.g. why Swarm can't start the service). */
  explanation?: string;
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
 * Deployed, then stopped: the engine resets the status to "idle" (same as
 * never-deployed), but the stopped containers still exist on the engine.
 */
export function isStopped(s: Pick<Service, "status" | "runtime">): boolean {
  return s.status === "idle" && !!s.runtime && s.runtime.total > 0 && s.runtime.running === 0;
}

const STOPPED: StatusDisplay = { label: "Stopped", color: "var(--color-idle)", soft: "var(--color-idle-soft)" };

/** Clip a one-line detail so badges stay badge-sized (full text goes in `explanation`). */
function clip(text: string, max = 48): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * What a status indicator should show: engine truth when we have it, deploy
 * lifecycle otherwise. An in-flight deploy ("Deploying") and a never-deployed
 * service ("Idle") win over the runtime sweep — containers legitimately churn
 * during the former and don't exist yet for the latter. A failed deploy with
 * nothing running says so ("Deploy failed"), rather than a vaguer
 * "Not running · 0/0".
 */
export function resolveServiceDisplay(status: string, runtime?: ServiceRuntime): StatusDisplay {
  if (isStopped({ status: status as Service["status"], runtime })) return STOPPED;
  if (status === "running" || status === "idle" || !runtime) {
    const meta = STATUS_META[status] ?? STATUS_META.idle;
    return status === "error" ? { ...meta, label: "Deploy failed" } : meta;
  }
  const meta = RUNTIME_META[runtime.health];
  if (runtime.health === "running") {
    return status === "error"
      ? { ...meta, detail: "latest deploy failed", explanation: "The previous version is still serving; the newest deploy failed." }
      : meta;
  }
  const why = runtime.issue ? (explainDeployError(runtime.issue) ?? runtime.issue) : undefined;
  const base = status === "error" ? { ...STATUS_META.error, label: "Deploy failed" } : meta;
  if (runtime.health === "not-running" && runtime.issue) {
    return { ...base, detail: clip(runtime.issue), explanation: why };
  }
  if (status === "error" && runtime.total === 0) return base;
  return { ...base, detail: `${runtime.running}/${runtime.total} containers running`, explanation: why };
}
