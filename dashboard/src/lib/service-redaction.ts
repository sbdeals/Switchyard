import type { Service } from "./dokploy";

/** Redact page props without changing the full services used on the server. */
export function redactServiceForClient(service: Service): Service {
  return service.kind === "database"
    ? { ...service, env: null, databasePassword: null }
    : { ...service, env: null };
}
