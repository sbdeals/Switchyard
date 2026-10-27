import type { Service } from "./dokploy";

export type PublishedPort = { port: number; protocol: "tcp" | "udp" };
type PortOwner = { serviceId: string; serviceName: string };
export type PortWarning = PublishedPort & { conflicts: PortOwner[]; reserved: boolean };

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function isReservedHostPort(port: number): boolean {
  return [80, 443, 3000, 3001].includes(port);
}

export function collectPublishedPorts(services: readonly Service[]): (PublishedPort & PortOwner)[] {
  return services.flatMap((service) => {
    const ports: PublishedPort[] = service.kind === "application"
      ? service.ports.map((p) => ({ port: p.publishedPort, protocol: p.protocol }))
      : service.kind === "database"
        ? service.externalPort === null ? [] : [{ port: service.externalPort, protocol: "tcp" }]
        : service.publishedPorts ?? parseComposePorts(service.composeFile);
    return ports.filter((p) => isValidPort(p.port) && (p.protocol === "tcp" || p.protocol === "udp"))
      .map((p) => ({ ...p, serviceId: service.id, serviceName: service.name }));
  });
}

export function findPortConflicts(
  ports: ReturnType<typeof collectPublishedPorts>,
  serviceId: string,
  proposed: PublishedPort,
): PortOwner[] {
  if (!isValidPort(proposed.port)) return [];
  return [...(indexPortOwners(ports, serviceId).get(`${proposed.port}/${proposed.protocol}`)?.values() ?? [])];
}

function indexPortOwners(ports: ReturnType<typeof collectPublishedPorts>, serviceId: string) {
  const byPort = new Map<string, Map<string, PortOwner>>();
  for (const port of ports) {
    if (port.serviceId === serviceId) continue;
    const key = `${port.port}/${port.protocol}`;
    const owners = byPort.get(key) ?? new Map<string, PortOwner>();
    owners.set(port.serviceId, { serviceId: port.serviceId, serviceName: port.serviceName });
    byPort.set(key, owners);
  }
  return byPort;
}

export function getPortWarnings(
  services: readonly Service[],
  serviceId: string,
  proposed: readonly PublishedPort[],
): PortWarning[] {
  const byPort = indexPortOwners(collectPublishedPorts(services), serviceId);
  const seen = new Set<string>();
  return proposed.flatMap((port) => {
    const key = `${port.port}/${port.protocol}`;
    if (!isValidPort(port.port) || (port.protocol !== "tcp" && port.protocol !== "udp") || seen.has(key)) return [];
    seen.add(key);
    const conflicts = [...(byPort.get(key)?.values() ?? [])];
    const reserved = isReservedHostPort(port.port);
    return conflicts.length || reserved ? [{ ...port, conflicts, reserved }] : [];
  });
}

function scalar(value: string): string {
  const trimmed = value.trim();
  return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/** Split a flow list/map without splitting quoted strings or nested flow maps. */
function splitFlow(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") depth--;
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  return quote || depth !== 0 ? [] : [...parts, value.slice(start).trim()];
}

function withoutComment(value: string): string {
  let quote = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "#" && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}

function portRange(value: string): [number, number] | null {
  if (!/^\d+(?:-\d+)?$/.test(value)) return null;
  const [start, end = start] = value.split("-").map(Number);
  return isValidPort(start) && isValidPort(end) && end >= start ? [start, end] : null;
}

function parseEntry(lines: string[]): PublishedPort[] {
  if (lines.some((line) => line.includes("$"))) return [];
  if (lines[0] === "") lines = lines.slice(1);
  const first = lines[0];
  if (!first) return [];
  let range: [number, number] | null;
  let protocol: PublishedPort["protocol"] = "tcp";
  if (/^\{.*\}$/.test(first) || /^[\w"']+\s*:\s/.test(first)) {
    if (first.startsWith("{") && lines.length !== 1) return [];
    const fields = new Map<string, string>();
    const entries = first.startsWith("{") ? splitFlow(first.slice(1, -1)) : lines;
    for (const entry of entries) {
      const field = entry.match(/^([\w"']+)\s*:\s*(.*?)\s*$/);
      if (!field || !field[2] || fields.has(scalar(field[1]))) return [];
      fields.set(scalar(field[1]), scalar(field[2]));
    }
    const target = fields.get("target") ?? "";
    if (!/^\d+$/.test(target) || !isValidPort(Number(target))) return [];
    const rawProtocol = fields.get("protocol") ?? "tcp";
    if (rawProtocol !== "tcp" && rawProtocol !== "udp") return [];
    protocol = rawProtocol;
    range = portRange(fields.get("published") ?? "");
  } else {
    if (lines.length !== 1) return [];
    const mapping = scalar(first).match(/^(?:(?:\[[\da-fA-F:.]+\]|[\d.]+):)?(\d+(?:-\d+)?):(\d+(?:-\d+)?)(?:\/(tcp|udp))?$/);
    if (!mapping) return [];
    range = portRange(mapping[1]);
    const target = portRange(mapping[2]);
    if (!range || !target || range[1] - range[0] !== target[1] - target[0]) return [];
    protocol = mapping[3] === "udp" ? "udp" : "tcp";
  }
  if (!range) return [];
  return Array.from({ length: range[1] - range[0] + 1 }, (_, i) => ({ port: range[0] + i, protocol }));
}

/**
 * Best-effort static Compose ports, following the existing line-parser approach.
 * Reads block services with short/long port entries (including inline lists).
 * Interpolation, aliases and unsupported YAML shapes are left unknown.
 */
export function parseComposePorts(file: string | null): PublishedPort[] {
  if (!file) return [];
  const lines = file.split(/\r?\n/).map((raw) => {
    const line = withoutComment(raw);
    return { indent: line.length - line.trimStart().length, text: line.trim() };
  });
  const parents: { indent: number; key: string; literal: boolean }[] = [];
  const result: PublishedPort[] = [];
  for (let i = 0; i < lines.length; i++) {
    const { indent, text } = lines[i];
    if (!text) continue;
    while (parents.length && parents[parents.length - 1].indent >= indent) parents.pop();
    if (parents.some((parent) => parent.literal)) continue;
    const field = text.match(/^([^:]+):(?:\s+(.*))?$/);
    if (!field) continue;
    const key = scalar(field[1]);
    const value = field[2] ?? "";
    if (key === "ports" && parents.length === 2 && parents[0].key === "services" && parents[0].indent === 0) {
      if (value.startsWith("[") && value.endsWith("]")) {
        for (const entry of splitFlow(value.slice(1, -1))) {
          for (const port of parseEntry([entry])) result.push(port);
        }
      } else if (!value) {
        let entry: string[] = [];
        let listIndent: number | null = null;
        let fieldIndent: number | null = null;
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j];
          if (!next.text) continue;
          const item = next.text.match(/^-(?:\s+(.*))?$/);
          if (next.indent < indent || (next.indent === indent && !item)) break;
          if (item && (listIndent === null || listIndent === next.indent)) {
            if (entry.length) for (const port of parseEntry(entry)) result.push(port);
            listIndent = next.indent;
            fieldIndent = item[1] ? next.indent + next.text.length - item[1].length : null;
            entry = [item[1] ?? ""];
          } else if (entry.length && listIndent !== null && next.indent > listIndent) {
            fieldIndent ??= next.indent;
            entry.push(next.indent === fieldIndent ? next.text : ":");
          } else {
            entry = [];
            break;
          }
        }
        if (entry.length) for (const port of parseEntry(entry)) result.push(port);
      }
    }
    parents.push({ indent, key, literal: /^[>|]/.test(value) });
  }
  return result;
}
