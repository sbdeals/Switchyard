import type { Service } from "./dokploy";

/** Redact page props without changing the full services used on the server. */
export function redactServiceForClient(service: Service): Service {
  if (service.kind === "application") {
    return { ...service, env: null, buildArgs: null };
  }
  if (service.kind === "database") {
    return { ...service, env: null, databasePassword: null };
  }
  return { ...service, env: null };
}
