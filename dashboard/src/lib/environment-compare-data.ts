import "server-only";
import { request } from "./dokploy";
import { summarizeCompose } from "./compose-summary";
import type { ComparisonService } from "./environment-compare";

const serviceTypes = [
  ["applications", "application", "applicationId"],
  ["compose", "compose", "composeId"],
  ["postgres", "postgres", "postgresId"],
  ["mysql", "mysql", "mysqlId"],
  ["mariadb", "mariadb", "mariadbId"],
  ["mongo", "mongo", "mongoId"],
  ["redis", "redis", "redisId"],
] as const;

type Environment = { environmentId: string } & Partial<Record<
  typeof serviceTypes[number][0], Record<string, string>[]
>>;
interface Project { projectId: string; environments: Environment[] }
type Detail = Record<string, unknown>;
type ServiceRef = { id: string; kind: string; idKey: string };

function validId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

/** Always resolve membership from the current user's tree, never from client IDs alone. */
async function environments(projectId: string, ids: string[]): Promise<Environment[]> {
  if (!validId(projectId) || !ids.every(validId)) throw new Error("Invalid environment selection.");
  const tree = await request<Project[]>("project.all");
  const project = tree.find((p) => p.projectId === projectId);
  return ids.map((id) => {
    const env = project?.environments.find((e) => e.environmentId === id);
    if (!env) throw new Error("Environment unavailable.");
    return env;
  });
}

function references(env: Environment): ServiceRef[] {
  return serviceTypes.flatMap(([collection, kind, idKey]) =>
    (env[collection] ?? []).map((entry) => ({ id: entry[idKey], kind, idKey }))
  );
}

async function detail(env: Environment, ref: ServiceRef): Promise<Detail> {
  const value = await request<Detail>(`${ref.kind}.one?${ref.idKey}=${encodeURIComponent(ref.id)}`);
  // A service could have moved after project.all was read.
  if (value.environmentId !== env.environmentId) throw new Error("Service moved; compare again.");
  return value;
}

const string = (value: unknown): string | null => typeof value === "string" ? value : null;

function source(d: Detail): { source: string | null; branch: string | null } {
  const nonempty = (value: unknown) => string(value)?.trim() || null;
  const type = nonempty(d.sourceType);
  if (!type || type === "raw" || type === "docker") return { source: type, branch: null };
  const prefix = type && ["gitlab", "bitbucket", "gitea"].includes(type) ? type : "";
  const repository = nonempty(type === "git" ? d.customGitUrl : d[prefix ? `${prefix}Repository` : "repository"]);
  const owner = type === "git" ? null : nonempty(d[prefix ? `${prefix}Owner` : "owner"]);
  let location = repository && owner && !repository.includes("://") ? `${owner}/${repository}` : repository;
  if (location?.includes("://")) {
    try {
      const url = new URL(location);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      location = url.toString();
    } catch {
      location = "Invalid repository URL";
    }
  }
  return {
    source: [type, location].filter(Boolean).join(": ") || null,
    branch: nonempty(type === "git" ? d.customGitBranch : d[prefix ? `${prefix}Branch` : "branch"]),
  };
}

async function services(env: Environment): Promise<ComparisonService[]> {
  return Promise.all(references(env).map(async (ref) => {
    const d = await detail(env, ref);
    const compose = ref.kind === "compose" ? summarizeCompose(string(d.composeFile)) : null;
    return {
      id: ref.id,
      name: string(d.name) ?? ref.id,
      kind: ref.kind,
      image: compose ? compose.image : string(d.dockerImage),
      ...source(d),
      buildType: compose ? compose.buildType : string(d.buildType),
      replicas: compose ? compose.replicas : typeof d.replicas === "number" ? d.replicas : 1,
      domainsCount: Array.isArray(d.domains) ? d.domains.length : 0,
      env: string(d.env),
    };
  }));
}

export async function loadComparisonPair(projectId: string, aId: string, bId: string) {
  if (aId === bId) throw new Error("Choose two different environments.");
  const [a, b] = await environments(projectId, [aId, bId]);
  const [aServices, bServices] = await Promise.all([services(a), services(b)]);
  return { a: aServices, b: bServices };
}
