import type { MountType, ServiceKind } from "./dokploy";

/** Only already-loaded metadata is needed to describe a deletion. */
export interface ImpactService {
  kind: ServiceKind;
  env?: string | null;
  environmentVariableCount?: number;
  domains?: readonly unknown[];
  mounts?: readonly { type: MountType }[];
  deployments?: readonly unknown[];
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Names are case-sensitive; surrounding whitespace is not significant. */
export function nameMatches(input: string, name: string): boolean {
  return name.trim().length > 0 && input.trim() === name.trim();
}

/** Count dotenv assignments, ignoring comments and lines inside quoted values. */
export function variableCount(env: string | null): number {
  const names = new Set<string>();
  let quote: string | null = null;
  for (const line of (env ?? "").split(/\r?\n/)) {
    let value = line;
    if (!quote) {
      const assignment = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
      if (!assignment) continue;
      names.add(assignment[1]);
      value = assignment[2];
      if (!/^["'`]/.test(value)) continue;
      quote = value[0];
      value = value.slice(1);
    }
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "\\" && quote !== "'") {
        i++;
      } else if (value[i] === quote) {
        quote = null;
        break;
      }
    }
  }
  return names.size;
}

function serviceCounts(services: readonly ImpactService[], includeEmpty = false): string[] {
  const hasCompose = services.some((service) => service.kind === "compose");
  const mountCategory = hasCompose ? "Attached volumes and mounts" : "Volumes and mounts";
  let domains = 0;
  let volumes = 0;
  let mounts = 0;
  let variables = 0;
  let deployments = 0;
  const unavailable = new Set<string>();

  for (const service of services) {
    if (service.domains) domains += service.domains.length;
    else if (service.kind !== "database") unavailable.add("Domains");

    if (service.mounts) {
      for (const mount of service.mounts) {
        if (mount.type === "volume") volumes++;
        else mounts++;
      }
    } else {
      unavailable.add(mountCategory);
    }

    if (service.environmentVariableCount !== undefined) variables += service.environmentVariableCount;
    else if (service.env === undefined) unavailable.add("Environment variables");
    else variables += variableCount(service.env);

    if (service.deployments) deployments += service.deployments.length;
    else unavailable.add("Deployments");
  }

  const counts: [number, string, string][] = [
    [domains, "domain", "Domains"],
    [volumes, hasCompose ? "attached volume" : "volume", mountCategory],
    [mounts, "other mount", mountCategory],
    [variables, "environment variable", "Environment variables"],
    [deployments, "deployment", "Deployments"],
  ];
  return [
    ...counts
      .filter(([count, , category]) => count > 0 || (includeEmpty && !unavailable.has(category)))
      .map(([count, label]) => pluralize(count, label)),
    ...(hasCompose ? ["Compose-defined containers and volumes (additional to attached mounts)"] : []),
    ...Array.from(unavailable, (label) => `${label} (count unavailable for some services)`),
  ];
}

/** Callers pass only services within the project or environment being deleted. */
export function deleteImpact(
  services: readonly ImpactService[],
  environmentCount?: number
): string[] {
  return [
    ...(environmentCount === undefined ? [] : [pluralize(environmentCount, "environment")]),
    pluralize(services.length, "service"),
    ...serviceCounts(services),
  ];
}

export function serviceDeleteImpact(service: ImpactService): string[] {
  return ["Service configuration and containers", ...serviceCounts([service], true)];
}
