export interface ServiceDetailsPatch {
  name: string;
  description?: string;
}

/** Display names are independent of the Docker/DNS identity (`appName`). */
export function validateServiceName(value: unknown): { name: string; error: string | null } {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { name, error: "Service name is required." };
  if (name.length > 63) return { name, error: "Service name must be 1–63 characters." };
  return { name, error: null };
}

interface NamedService {
  id: string;
  environmentId: string;
  name: string;
}

/** Duplicate display names are allowed; warn only within the current environment. */
export function serviceNameWarning(
  name: string,
  service: Pick<NamedService, "id" | "environmentId">,
  services: readonly NamedService[]
): string | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  const duplicate = services.some(
    (other) => other.id !== service.id &&
      other.environmentId === service.environmentId &&
      other.name.trim().toLowerCase() === normalized
  );
  return duplicate ? "Another service in this environment already has this name. You can still save it." : null;
}
