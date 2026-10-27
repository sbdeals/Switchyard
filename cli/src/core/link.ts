import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { UserError } from "./errors.js";

export interface Application {
  applicationId: string;
  name: string;
  domains?: { host: string; https?: boolean; path?: string | null }[];
}

export interface Environment {
  environmentId: string;
  name: string;
  applications?: Application[];
}

export interface Project {
  projectId: string;
  name: string;
  environments: Environment[];
}

export interface DirectoryLink {
  projectId: string;
  environmentId: string;
  applicationId: string;
}

export async function readLink(directory = process.cwd()): Promise<DirectoryLink | undefined> {
  let text: string;
  try {
    text = await readFile(join(directory, ".switchyard", "link.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new UserError("Cannot read .switchyard/link.json. Check its permissions or run `switchyard link` again.");
  }
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" &&
        ["projectId", "environmentId", "applicationId"].every((key) =>
          typeof (value as Record<string, unknown>)[key] === "string" &&
          ((value as Record<string, string>)[key] ?? "").trim())) {
      const { projectId, environmentId, applicationId } = value as DirectoryLink;
      return { projectId, environmentId, applicationId };
    }
  } catch { /* Report invalid links without echoing file contents. */ }
  throw new UserError("Invalid .switchyard/link.json. Run `switchyard link` again.");
}

export function linkedEnvironment(projects: Project[], link: DirectoryLink): { project: Project; environment: Environment } {
  const project = projects.find((p) => p.projectId === link.projectId);
  const environment = project?.environments.find((e) => e.environmentId === link.environmentId);
  if (!project || !environment) {
    throw new UserError("Linked project or environment no longer exists. Run `switchyard link` again.");
  }
  return { project, environment };
}

export function linkedApplication(environment: Environment, link: DirectoryLink): Application {
  const application = environment.applications?.find((a) => a.applicationId === link.applicationId);
  if (!application) throw new UserError("Linked service no longer exists in its environment. Run `switchyard link` again.");
  return application;
}

export function defaultEnvironment(project: Project): Environment {
  const production = project.environments.filter((e) => e.name.toLowerCase() === "production");
  const environments = production.length > 0 ? production : project.environments;
  if (environments.length !== 1) {
    throw new UserError(`Project ${project.name} needs a single production environment (or a single environment). Rename the intended environment to production in the dashboard.`);
  }
  return environments[0]!;
}

/** Variables never creates a target: resolve the link or an explicit, unique application. */
export async function resolveApplication(
  client: { request<T>(path: string): Promise<T> },
  service?: string,
  directory = process.cwd(),
): Promise<Application> {
  if (service !== undefined && !service.trim()) throw new UserError("Service must not be empty.");
  const link = await readLink(directory);
  if (!link && !service) throw new UserError("No linked service. Run `switchyard link` or pass --service <name-or-id>.");
  const projects = await client.request<Project[]>("project.all");
  const environment = link ? linkedEnvironment(projects, link).environment : undefined;
  if (link && !service) return linkedApplication(environment!, link);
  const applications = environment?.applications ?? (environment ? [] : projects.flatMap((p) =>
    p.environments.flatMap((e) => e.applications ?? [])));
  const matches = applications.filter((a) => a.applicationId === service || a.name === service);
  if (matches.length !== 1) {
    throw new UserError(matches.length === 0
      ? "Service not found. Run `switchyard link` or check --service <name-or-id>."
      : "More than one service matches. Run `switchyard link --project <name> --service <id>` or pass a unique --service <id>.");
  }
  return matches[0]!;
}
