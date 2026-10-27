import { isIP } from "node:net";

export interface DomainStatusQuery {
  serviceType: "application" | "compose";
  serviceId: string;
  domainId: string;
}

export interface OwnedDomainTarget extends DomainStatusQuery {
  host: string;
  https: boolean;
  path: string | null;
  expectedIps: string[];
}

/** Only stored IDs are accepted; callers cannot supply a host or override TLS. */
export function parseDomainStatusQuery(params: URLSearchParams): DomainStatusQuery | null {
  const keys = ["serviceType", "serviceId", "domainId"];
  if ([...params.keys()].some((key) => !keys.includes(key))) return null;
  if (keys.some((key) => params.getAll(key).length !== 1)) return null;
  const serviceType = params.get("serviceType");
  const serviceId = params.get("serviceId")!;
  const domainId = params.get("domainId")!;
  if (serviceType !== "application" && serviceType !== "compose") return null;
  if (![serviceId, domainId].every((id) => /^[\w-]{1,128}$/.test(id))) return null;
  return { serviceType, serviceId, domainId };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid workspace response");
  }
  return value as Record<string, unknown>;
}

/**
 * Resolve IDs using the current user's Dokploy client on EVERY check, including
 * cache hits. Do not read service.one until project.all proves membership.
 */
export async function resolveOwnedDomain(
  query: DomainStatusQuery,
  request: (path: string) => Promise<unknown>,
  hostIp?: string,
): Promise<OwnedDomainTarget | null> {
  const tree = await request("project.all");
  if (!Array.isArray(tree)) throw new Error("Invalid workspace response");
  const collection = query.serviceType === "application" ? "applications" : "compose";
  const idKey = `${query.serviceType}Id`;
  let owned = false;
  for (const project of tree) {
    const environments = record(project).environments;
    if (!Array.isArray(environments)) throw new Error("Invalid workspace response");
    for (const environment of environments) {
      const services = record(environment)[collection] ?? [];
      if (!Array.isArray(services)) throw new Error("Invalid workspace response");
      if (services.some((service) => record(service)[idKey] === query.serviceId)) owned = true;
    }
  }
  if (!owned) return null;

  const service = record(await request(
    `${query.serviceType}.one?${idKey}=${encodeURIComponent(query.serviceId)}`,
  ));
  if (service[idKey] !== query.serviceId) return null;
  const domains = service.domains ?? [];
  if (!Array.isArray(domains)) throw new Error("Invalid domain response");
  const domain = domains.map(record).find((item) => item.domainId === query.domainId);
  if (!domain) return null;
  // The nested relation is authoritative; also reject contradictory owner IDs.
  if (domain[idKey] != null && domain[idKey] !== query.serviceId) return null;
  const otherIdKey = query.serviceType === "application" ? "composeId" : "applicationId";
  if (domain[otherIdKey] != null) return null;
  if (typeof domain.host !== "string" || !domain.host.trim()) {
    throw new Error("Invalid domain response");
  }
  if (domain.https != null && typeof domain.https !== "boolean") {
    throw new Error("Invalid domain response");
  }
  if (domain.path != null && typeof domain.path !== "string") {
    throw new Error("Invalid domain response");
  }

  return {
    ...query,
    host: domain.host,
    https: domain.https === true,
    path: typeof domain.path === "string" ? domain.path : null,
    // A remote server may have a different public IP from this dashboard host.
    expectedIps: service.serverId == null && hostIp && isIP(hostIp) ? [hostIp] : [],
  };
}
