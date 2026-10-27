export type TabId =
  | "overview"
  | "connect"
  | "variables"
  | "data"
  | "deploy"
  | "build"
  | "domains"
  | "deployments"
  | "schedules"
  | "editor"
  | "volumes"
  | "metrics"
  | "logs"
  | "console"
  | "backups"
  | "settings";

type ServiceTarget = {
  id: string;
  kind: "database" | "application" | "compose";
  engine?: string;
  dockerImage?: string | null;
  composeFile?: string | null;
  /** Server-computed for client props, where composeFile is redacted. */
  hasPostgres?: boolean;
};

const DB_TABS: TabId[] = [
  "overview",
  "connect",
  "variables",
  "volumes",
  "metrics",
  "logs",
  "console",
  "backups",
  "settings",
];
const APP_TABS: TabId[] = [
  "overview",
  "variables",
  "deploy",
  "build",
  "domains",
  "deployments",
  "schedules",
  "volumes",
  "metrics",
  "logs",
  "console",
  "settings",
];
const COMPOSE_TABS: TabId[] = [
  "overview",
  "variables",
  "domains",
  "deployments",
  "editor",
  "volumes",
  "metrics",
  "logs",
  "console",
  "settings",
];

export function getServiceTabs(service: ServiceTarget): TabId[] {
  const base = service.kind === "database" ? DB_TABS : service.kind === "compose" ? COMPOSE_TABS : APP_TABS;
  const tabs = [...base];
  const postgres = service.kind === "database"
    ? service.engine === "postgres" || /postgres/i.test(service.dockerImage ?? "")
    : service.kind === "compose" &&
      (service.hasPostgres ?? /^[ \t]*image:[ \t]*["']?[^\n#"']*postgres/im.test(service.composeFile ?? ""));
  if (postgres) tabs.splice(1, 0, "data");
  return tabs;
}

export function parseDeeplink(query: string | URLSearchParams, services: readonly ServiceTarget[]) {
  const params = new URLSearchParams(query);
  const serviceId = params.get("service");
  const service = serviceId ? services.find((candidate) => candidate.id === serviceId) : undefined;
  const requestedTab = params.get("tab");
  const validTab = service && getServiceTabs(service).find((tab) => tab === requestedTab);
  const tab: TabId = validTab ?? "overview";
  return {
    serviceId: service?.id ?? null,
    tab,
    invalidService: params.has("service") && !service,
    invalidTab: params.has("tab") && !validTab,
  };
}

/** Preserve unrelated query parameters while replacing the drawer selection. */
export function serializeDeeplink(query: string | URLSearchParams, serviceId: string | null, tab?: TabId): string {
  const params = new URLSearchParams(query);
  params.delete("service");
  params.delete("tab");
  if (serviceId) {
    params.set("service", serviceId);
    if (tab) params.set("tab", tab);
  }
  return params.toString();
}

/** Only local absolute paths may be used after login. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (Array.from(value).some((char) => char === "\\" || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return "/";
  const url = new URL(value, "http://localhost");
  if (url.pathname.startsWith("//") || url.pathname.replace(/\/+$/, "") === "/login") return "/";
  return url.pathname + url.search + url.hash;
}
