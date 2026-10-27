export interface ComparisonService {
  id: string;
  name: string;
  kind: string;
  image: string | null;
  source: string | null;
  branch: string | null;
  buildType: string | null;
  replicas: number | string | null;
  domainsCount: number;
  env: string | null;
}

export type ComparisonServiceMetadata = Omit<ComparisonService, "env">;

const comparisonFields = [
  "kind", "image", "source", "branch", "buildType", "replicas", "domainsCount",
] as const;

export interface VariableComparison {
  key: string;
  status: "added" | "removed" | "changed" | "unchanged";
}

export interface ServiceComparison {
  name: string;
  status: "only-a" | "only-b" | "changed" | "identical";
  a: ComparisonServiceMetadata | null;
  b: ComparisonServiceMetadata | null;
  differences: (typeof comparisonFields)[number][];
  variables: VariableComparison[];
}

/** Parse dotenv values without expansion; the last assignment to a key wins. */
export function parseEnvironment(env: string | null): Map<string, string> {
  const result = new Map<string, string>();
  const lines = (env ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^[ \t]*(?:export[ \t]+)?([\w.-]+)[ \t]*=[ \t]*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const quote = raw[0];
    let value: string;
    if (quote === '"' || quote === "'" || quote === "`") {
      let quoted = raw.slice(1);
      let end = closingQuote(quoted, quote);
      while (end === -1 && i + 1 < lines.length) {
        quoted += `\n${lines[++i]}`;
        end = closingQuote(quoted, quote);
      }
      if (end === -1 || !/^[ \t]*(?:#.*)?$/.test(quoted.slice(end + 1))) {
        throw new Error("Invalid quoted environment variable.");
      }
      value = quoted.slice(0, end);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    } else {
      value = raw.split("#", 1)[0].trim();
    }
    result.set(key, value);
  }
  return result;
}

function closingQuote(value: string, quote: string): number {
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === quote && !escaped) return i;
    escaped = value[i] === "\\" && !escaped;
  }
  return -1;
}

function servicesByName(services: ComparisonService[]): Map<string, ComparisonService> {
  const result = new Map<string, ComparisonService>();
  for (const service of services) {
    if (result.has(service.name)) {
      throw new Error("Cannot compare environments with duplicate service names.");
    }
    result.set(service.name, service);
  }
  return result;
}

function metadata(service: ComparisonService | undefined): ComparisonServiceMetadata | null {
  if (!service) return null;
  // Copy the allowlist explicitly so additional server fields cannot leak out.
  return {
    id: service.id,
    name: service.name,
    kind: service.kind,
    image: service.image,
    source: service.source,
    branch: service.branch,
    buildType: service.buildType,
    replicas: service.replicas,
    domainsCount: service.domainsCount,
  };
}

/** Compare exact service names. Variable changes are directional, from A to B. */
export function compareEnvironments(a: ComparisonService[], b: ComparisonService[]): ServiceComparison[] {
  const aByName = servicesByName(a);
  const bByName = servicesByName(b);
  const names = [...new Set([...aByName.keys(), ...bByName.keys()])].sort();
  return names.map((name) => {
    const aService = aByName.get(name);
    const bService = bByName.get(name);
    const aEnv = parseEnvironment(aService?.env ?? null);
    const bEnv = parseEnvironment(bService?.env ?? null);
    const keys = [...new Set([...aEnv.keys(), ...bEnv.keys()])].sort();
    const variables: VariableComparison[] = keys.map((key) => ({
      key,
      status: !aEnv.has(key) ? "added" : !bEnv.has(key) ? "removed"
        : aEnv.get(key) === bEnv.get(key) ? "unchanged" : "changed",
    }));
    const differences = aService && bService
      ? comparisonFields.filter((field) => aService[field] !== bService[field])
      : [];
    return {
      name,
      status: !aService ? "only-b" : !bService ? "only-a"
        : differences.length > 0 || variables.some((variable) => variable.status !== "unchanged")
          ? "changed" : "identical",
      a: metadata(aService),
      b: metadata(bService),
      differences,
      variables,
    };
  });
}
