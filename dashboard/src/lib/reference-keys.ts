import type { Service } from "./dokploy";
import { variableRows } from "./variable-rows";

/** The picker reads only key names computed on the server, never env or credentials. */
export function referenceableKeys(service: Service, template?: string): { own: string[]; builtin: string[] } {
  const metadata = service.referenceKeys ?? { own: [], builtin: [] };
  const own = template === undefined ? metadata.own : [...new Set(variableRows(template).map((row) => row.key))];
  return { own, builtin: metadata.builtin.filter((key) => !own.includes(key)) };
}
