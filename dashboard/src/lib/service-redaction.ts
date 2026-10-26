import type { Service } from "./dokploy";
import { computeReferenceKeys } from "./reference-vars";

/** Redact page props without changing the full services used on the server. */
export function redactServiceForClient(service: Service): Service {
  const referenceKeys = computeReferenceKeys(service);
  if (service.kind === "database") return { ...service, referenceKeys, env: null, databasePassword: null };
  return { ...service, referenceKeys, env: null };
}
