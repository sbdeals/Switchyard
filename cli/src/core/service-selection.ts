import { basename, resolve } from "node:path";

import { UserError } from "./errors.js";

export type ServiceType = "application" | "compose" | "postgres" | "mysql" | "mariadb" | "mongo" | "redis";

export interface ServiceSelection {
  serviceId: string;
  name: string;
  type: ServiceType;
}

export interface Environment {
  environmentId: string;
  name: string;
  applications?: { applicationId: string; name: string }[];
  compose?: { composeId: string; name: string }[];
  postgres?: { postgresId: string; name: string }[];
  mysql?: { mysqlId: string; name: string }[];
  mariadb?: { mariadbId: string; name: string }[];
  mongo?: { mongoId: string; name: string }[];
  redis?: { redisId: string; name: string }[];
}

export interface Project {
  projectId: string;
  name: string;
  environments: Environment[];
}

export interface ServiceLookupClient {
  request<T>(path: string): Promise<T>;
}

export function selectProject(projects: Project[], selector?: string): Project | undefined {
  if (selector !== undefined && !selector.trim()) throw new UserError("Project names must not be empty.");
  const byId = selector ? projects.find((project) => project.projectId === selector) : undefined;
  if (byId) return byId;
  const matches = selector ? projects.filter((project) => project.name === selector) : projects;
  if (matches.length > 1) {
    throw new UserError(selector
      ? `More than one project is named ${selector}; select its ID with --project <id>.`
      : "More than one project exists. Select one with --project <name|id>.");
  }
  return matches[0];
}

export function selectEnvironment(project: Project): Environment {
  const production = project.environments.filter((environment) => environment.name.toLowerCase() === "production");
  const environments = production.length > 0 ? production : project.environments;
  if (environments.length !== 1) {
    throw new UserError(`Project ${project.name} needs a single production environment (or a single environment). Rename the intended environment to production in the dashboard.`);
  }
  return environments[0]!;
}

export function findService(
  project: Project,
  environment: Environment,
  selector: string,
  types?: ServiceType[],
): ServiceSelection | undefined {
  if (!selector.trim()) throw new UserError("Service names must not be empty.");
  const services: ServiceSelection[] = [
    ...(environment.applications ?? []).map((service) => ({ serviceId: service.applicationId, name: service.name, type: "application" as const })),
    ...(environment.compose ?? []).map((service) => ({ serviceId: service.composeId, name: service.name, type: "compose" as const })),
    ...(environment.postgres ?? []).map((service) => ({ serviceId: service.postgresId, name: service.name, type: "postgres" as const })),
    ...(environment.mysql ?? []).map((service) => ({ serviceId: service.mysqlId, name: service.name, type: "mysql" as const })),
    ...(environment.mariadb ?? []).map((service) => ({ serviceId: service.mariadbId, name: service.name, type: "mariadb" as const })),
    ...(environment.mongo ?? []).map((service) => ({ serviceId: service.mongoId, name: service.name, type: "mongo" as const })),
    ...(environment.redis ?? []).map((service) => ({ serviceId: service.redisId, name: service.name, type: "redis" as const })),
  ].filter((service) => !types || types.includes(service.type));
  const byId = services.find((service) => service.serviceId === selector);
  if (byId) return byId;
  const matches = services.filter((service) => service.name === selector);
  if (matches.length > 1) {
    const kind = types?.length === 1 && types[0] === "application" ? "application" : "service";
    throw new UserError(`More than one ${kind} is named ${selector} in ${project.name}/${environment.name}; select its ID with --service <id>.`);
  }
  return matches[0];
}

/** Resolve an existing service using deploy's project, environment and directory defaults. */
export async function resolveService(
  client: ServiceLookupClient,
  flags: { service?: string; project?: string },
  path = ".",
): Promise<ServiceSelection> {
  const name = flags.service ?? basename(resolve(path));
  if (!name.trim() || (flags.project !== undefined && !flags.project.trim())) {
    throw new UserError("Service and project names must not be empty.");
  }
  const project = selectProject(await client.request<Project[]>("project.all"), flags.project);
  if (!project) {
    throw new UserError(flags.project ? `Unknown project: ${flags.project}.` : "No projects found. Deploy a service before reading its logs.");
  }
  const environment = selectEnvironment(project);
  const service = findService(project, environment, name);
  if (!service) throw new UserError(`Unknown service: ${name} in ${project.name}/${environment.name}. Select one with --service <name|id>.`);
  return service;
}
