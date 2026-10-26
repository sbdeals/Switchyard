import type { Service } from "./dokploy";

/** The picker reads only key names computed on the server, never env or credentials. */
export function referenceableKeys(service: Service): { own: string[]; builtin: string[] } {
  return service.referenceKeys ?? { own: [], builtin: [] };
}
