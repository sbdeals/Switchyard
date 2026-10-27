import { load } from "js-yaml";

export interface ComposeVolume {
  serviceName: string;
  source: string | null;
  target: string;
  type: "volume" | "bind" | "tmpfs" | "other";
}

interface ComposeVolumesResult {
  volumes: ComposeVolume[];
  error: string | null;
}

const READ_ERROR = "Some compose mounts could not be read. Check the Compose tab.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Split short syntax without splitting Windows drives or ${VAR:-defaults}. */
function shortParts(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "$" && value[i + 1] === "{") {
      depth++;
      i++;
    } else if (value[i] === "}" && depth > 0) {
      depth--;
    } else if (value[i] === ":" && depth === 0) {
      const drive = i === start + 1 && /[a-z]/i.test(value[start]) && /[\\/]/.test(value[i + 1] ?? "");
      // A single-letter named volume (a:/data[:ro]) is not a host drive.
      if (drive && (parts.length > 0 || value[i + 1] === "\\" || /:(?:[/\\$]|[a-z]:[\\/])/i.test(value.slice(i + 2)))) continue;
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function parseVolume(entry: unknown, serviceName: string): ComposeVolume | null {
  if (typeof entry === "string") {
    const parts = shortParts(entry);
    if (parts.length > 3 || parts.some((part) => !part.trim())) return null;
    const anonymous = parts.length === 1 || (
      parts.length === 2 && /^(ro|rw|z|Z|nocopy|cached|delegated|consistent)(,(ro|rw|z|Z|nocopy|cached|delegated|consistent))*$/.test(parts[1])
    );
    const source = anonymous ? null : parts[0];
    const target = anonymous ? parts[0] : parts[1];
    if (!/^(?:[/\\$]|[a-z]:[\\/])/i.test(target)) return null;
    const type = source === null
      ? "volume"
      : /^(?:[./~\\]|[a-z]:[\\/])/i.test(source)
        ? "bind"
        : source.includes("$") ? "other" : "volume";
    return { serviceName, source, target, type };
  }

  if (!isRecord(entry) || typeof entry.target !== "string" || !entry.target.trim()) return null;
  if (typeof entry.type !== "string" || !entry.type) return null;
  if (entry.source != null && typeof entry.source !== "string") return null;
  const source = typeof entry.source === "string" && entry.source ? entry.source : null;
  if (entry.type === "bind" && !source) return null;
  const type = entry.type === "volume" || entry.type === "bind" || entry.type === "tmpfs"
    ? entry.type
    : "other";
  return { serviceName, source, target: entry.target, type };
}

/** Read declarations only; do not interpolate env values or inspect Docker. */
export function parseComposeVolumes(file: string | null): ComposeVolumesResult {
  if (file === null) {
    return { volumes: [], error: "Compose file is unavailable; declared mounts cannot be listed." };
  }
  let document: unknown;
  try {
    document = load(file);
  } catch {
    // YAML errors can quote unrelated compose content, including credentials.
    return { volumes: [], error: READ_ERROR };
  }
  if (document == null) return { volumes: [], error: null };
  if (!isRecord(document)) return { volumes: [], error: READ_ERROR };
  let error = document.include ? READ_ERROR : null;
  if (document.services == null) return { volumes: [], error };
  if (!isRecord(document.services)) return { volumes: [], error: READ_ERROR };

  const volumes: ComposeVolume[] = [];
  for (const [serviceName, service] of Object.entries(document.services)) {
    if (!isRecord(service)) {
      error = READ_ERROR;
      continue;
    }
    if (service.extends || service.volumes_from) error = READ_ERROR;
    if (service.volumes == null) continue;
    if (!Array.isArray(service.volumes)) {
      error = READ_ERROR;
      continue;
    }
    for (const entry of service.volumes) {
      const volume = parseVolume(entry, serviceName);
      if (volume) volumes.push(volume);
      else error = READ_ERROR;
    }
  }
  return { volumes, error };
}
