import type { Service } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";

/** Brand accent for applications (databases use their engine accent). */
export const APP_ACCENT = "#a06bff";

export function serviceAccent(s: Service): string {
  return s.kind === "database" ? ENGINE_META[s.engine].accent : APP_ACCENT;
}

/** Human label, e.g. "PostgreSQL" or "Docker image". */
export function serviceLabel(s: Service): string {
  if (s.kind === "database") return ENGINE_META[s.engine].label;
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
