import type { Service } from "@/lib/dokploy";
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

/** Display metadata for each lifecycle status (shared by badge and canvas). */
export const STATUS_META: Record<
  string,
  { label: string; color: string; soft: string; pulse?: boolean }
> = {
  done: { label: "Running", color: "var(--color-ok)", soft: "var(--color-ok-soft)" },
  running: {
    label: "Deploying",
    color: "var(--color-warn)",
    soft: "var(--color-warn-soft)",
    pulse: true,
  },
  error: { label: "Error", color: "var(--color-danger)", soft: "var(--color-danger-soft)" },
  idle: { label: "Idle", color: "var(--color-idle)", soft: "var(--color-idle-soft)" },
};
