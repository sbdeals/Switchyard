export interface ServiceReference {
  serviceName: string;
  variable: string;
}

export interface ReferenceService {
  id: string;
  name: string;
  appName: string;
  projectId: string;
  environmentId: string;
  env: string | null;
}

export interface ServiceEdge {
  source: string;
  target: string;
}

export interface ServiceReferenceEdge extends ServiceEdge {
  kind: "reference";
  variables: string[];
}

export interface InferredServiceEdge extends ServiceEdge {
  kind: "inferred";
}

export interface ReferenceWarning extends ServiceReference {
  reason: "missing" | "ambiguous";
}

export interface ServiceReferenceGraph {
  edges: (ServiceReferenceEdge | InferredServiceEdge)[];
  warnings: Record<string, ReferenceWarning[]>;
}

/** Read dotenv assignment values, including quoted multiline values, without comments. */
function assignmentValues(env: string): string[] {
  const lines = env.split(/\r?\n/);
  const values: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const assignment = lines[i].match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
    if (!assignment) continue;
    let value = assignment[1];
    const quote = value[0];
    if (quote !== '"' && quote !== "'") {
      values.push(value.split("#", 1)[0]);
      continue;
    }

    // A quoted value can contain literal newlines and comment characters.
    let end = 1;
    while (true) {
      if (end >= value.length) {
        if (++i >= lines.length) break;
        value += `\n${lines[i]}`;
      }
      if (value[end] === "\\") end += 2;
      else if (value[end] === quote) {
        values.push(value.slice(1, end));
        break;
      } else end++;
    }
  }
  return values;
}

/** Only explicit ${{ServiceName.VAR}} references count; never expose env values. */
export function parseServiceReferences(env: string | null): ServiceReference[] {
  const references = new Map<string, ServiceReference>();
  for (const value of assignmentValues(env ?? "")) {
    // Display names may contain spaces or dots; the final dot separates VAR.
    const pattern = /\$\{\{([^{}\r\n]+)\.[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\}\}/g;
    for (const match of value.matchAll(pattern)) {
      const reference = { serviceName: match[1].trim(), variable: match[2] };
      if (!reference.serviceName) continue;
      references.set(JSON.stringify([reference.serviceName, reference.variable]), reference);
    }
  }
  return [...references.values()];
}

/**
 * Preserve connection-string hints via the legacy case-insensitive name/appName
 * substring heuristic. Ignore comments and explicit reference tokens so a broken
 * or out-of-scope reference cannot also create a misleading inferred edge.
 */
export function inferEdges(services: readonly ReferenceService[]): ServiceEdge[] {
  const edges: ServiceEdge[] = [];
  const seen = new Set<string>();
  for (const source of services) {
    const haystack = assignmentValues(source.env ?? "")
      .join("\n")
      .replace(/\$\{\{[^{}]*\}\}/g, "")
      .toLowerCase();
    if (!haystack) continue;
    for (const target of services) {
      if (source.id === target.id) continue;
      const needles = [target.appName, target.name].filter(Boolean).map((s) => s.toLowerCase());
      if (needles.some((name) => name.length > 2 && haystack.includes(name))) {
        const key = JSON.stringify([source.id, target.id]);
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ source: source.id, target: target.id });
        }
      }
    }
  }
  return edges;
}

/**
 * Explicit names resolve exactly within the source's project and environment.
 * Self references draw no loop; missing or ambiguous targets become warnings.
 * Merge legacy inferred hints only for pairs without an explicit reference.
 */
export function buildServiceReferenceGraph(services: readonly ReferenceService[]): ServiceReferenceGraph {
  const scopeKey = (service: ReferenceService, name: string) =>
    JSON.stringify([service.projectId, service.environmentId, name]);
  const byName = new Map<string, ReferenceService[]>();
  for (const service of services) {
    const key = scopeKey(service, service.name);
    const candidates = byName.get(key) ?? [];
    candidates.push(service);
    byName.set(key, candidates);
  }

  const edges: ServiceReferenceGraph["edges"] = [];
  const warnings = new Map<string, ReferenceWarning[]>();
  for (const service of services) {
    const byTarget = new Map<string, ServiceReferenceEdge>();
    for (const reference of parseServiceReferences(service.env)) {
      const candidates = byName.get(scopeKey(service, reference.serviceName)) ?? [];
      if (candidates.length !== 1) {
        const serviceWarnings = warnings.get(service.id) ?? [];
        serviceWarnings.push({
          ...reference,
          reason: candidates.length === 0 ? "missing" : "ambiguous",
        });
        warnings.set(service.id, serviceWarnings);
        continue;
      }
      const target = candidates[0];
      if (service.id === target.id) continue;
      let edge = byTarget.get(target.id);
      if (!edge) {
        edge = { source: service.id, target: target.id, kind: "reference", variables: [] };
        byTarget.set(target.id, edge);
        edges.push(edge);
      }
      if (!edge.variables.includes(reference.variable)) edge.variables.push(reference.variable);
    }
  }
  const seen = new Set(edges.map((edge) => JSON.stringify([edge.source, edge.target])));
  for (const edge of inferEdges(services)) {
    const key = JSON.stringify([edge.source, edge.target]);
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ ...edge, kind: "inferred" });
    }
  }
  return { edges, warnings: Object.fromEntries(warnings) };
}
