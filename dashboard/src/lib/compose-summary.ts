import { DEFAULT_SCHEMA, load } from "js-yaml";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Extract only display metadata. Never return inline variables or build args. */
export function summarizeCompose(file: string | null): {
  image: string | null;
  buildType: string | null;
  replicas: string | null;
} {
  if (!file?.trim()) return { image: null, buildType: null, replicas: null };
  let document: unknown;
  try {
    // js-yaml is already shipped by the dashboard's ESLint dependency.
    document = load(file, { schema: DEFAULT_SCHEMA });
  } catch {
    // YAML parser errors can include source lines containing credentials.
    throw new Error("Unable to read compose configuration.");
  }
  const services = Object.entries(record(record(document).services)).sort(([a], [b]) => a.localeCompare(b));
  const images: string[] = [];
  const builds: string[] = [];
  const replicas: string[] = [];
  for (const [name, value] of services) {
    const service = record(value);
    const image = typeof service.image === "string" ? service.image : null;
    if (image) images.push(`${name}: ${image}`);
    builds.push(`${name}: ${service.build != null ? "build" : "image"}`);
    const count = record(service.deploy).replicas ?? service.scale ?? 1;
    replicas.push(`${name}: ${typeof count === "string" || typeof count === "number" ? count : "unknown"}`);
  }
  return {
    image: images.join("\n") || null,
    buildType: builds.join("\n") || null,
    replicas: replicas.join("\n") || null,
  };
}
