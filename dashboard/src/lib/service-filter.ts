import type { Service } from "./dokploy";

export const SERVICE_FILTERS = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "deploying", label: "Deploying" },
  { value: "error", label: "Error" },
  { value: "stopped", label: "Stopped" },
] as const;

export type ServiceFilterStatus = (typeof SERVICE_FILTERS)[number]["value"];

export interface ServiceFilter {
  q: string;
  status: ServiceFilterStatus;
}

export function readServiceFilter(params: Pick<URLSearchParams, "get">): ServiceFilter {
  const status = params.get("status");
  return {
    q: params.get("q") ?? "",
    status: SERVICE_FILTERS.find((filter) => filter.value === status)?.value ?? "all",
  };
}

export function serviceFilterUrl(href: string, filter: ServiceFilter): string {
  const url = new URL(href, "http://localhost");
  if (filter.q.trim()) url.searchParams.set("q", filter.q);
  else url.searchParams.delete("q");
  if (filter.status !== "all") url.searchParams.set("status", filter.status);
  else url.searchParams.delete("status");
  return `${url.pathname}${url.search}${url.hash}`;
}

function serviceStatus(service: Service): Exclude<ServiceFilterStatus, "all"> {
  // Match service-meta's precedence: deployment and idle override runtime.
  if (service.status === "running") return "deploying";
  if (service.status === "idle") return "stopped";
  if (service.runtime) {
    switch (service.runtime.health) {
      case "running": return "running";
      case "degraded": return "error";
      case "not-running": return "stopped";
    }
  }
  return service.status === "done" ? "running" : "error";
}

export function filterServices(services: Service[], filter: ServiceFilter): {
  matches: Service[];
  counts: Record<ServiceFilterStatus, number>;
} {
  const tokens = filter.q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const counts: Record<ServiceFilterStatus, number> = {
    all: 0, running: 0, deploying: 0, error: 0, stopped: 0,
  };
  const matches: Service[] = [];
  for (const service of services) {
    const text = [
      service.name,
      service.appName,
      service.dockerImage,
      service.projectName,
      service.environmentName,
      ...(service.kind === "application" ? [service.repository, service.gitUrl] : []),
    ].join(" ").toLowerCase();
    if (!tokens.every((token) => text.includes(token))) continue;
    const status = serviceStatus(service);
    counts.all += 1;
    counts[status] += 1;
    if (filter.status === "all" || filter.status === status) matches.push(service);
  }
  return { matches, counts };
}

/** An edge stays bright only when both endpoints match. */
export function serviceFilterOpacity(matches: boolean, targetMatches = true): number {
  return matches && targetMatches ? 1 : 0.2;
}

export function serviceFilterShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "isComposing" | "defaultPrevented">,
  context: { editable: boolean; overlayOpen: boolean; searchFocused: boolean },
): "focus" | "clear" | null {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || context.overlayOpen) {
    return null;
  }
  if (event.key === "/" && !context.editable) return "focus";
  if (event.key === "Escape" && context.searchFocused) return "clear";
  return null;
}
