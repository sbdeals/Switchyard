import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Command } from "commander";

import { loadConfig } from "../core/config.js";
import { UserError } from "../core/errors.js";
import { defaultEnvironment, type DirectoryLink, type Project } from "../core/link.js";
import { connectDeployClient, type DeployClient } from "./deploy.js";

export interface LinkFlags {
  project?: string;
  service?: string;
}

export function createLinkCommand(action: (flags: LinkFlags) => Promise<void> = linkCommand): Command {
  return new Command("link")
    .description("Link the current directory to an existing Dokploy application")
    .option("--project <name-or-id>", "project to link (default: the only project)")
    .option("--service <name-or-id>", "application to link (default: directory name or the only application)")
    .action(action);
}

export async function linkCommand(flags: LinkFlags): Promise<void> {
  const { config } = loadConfig();
  await linkDirectory(process.cwd(), flags, await connectDeployClient(config));
}

export async function linkDirectory(
  directory: string,
  flags: LinkFlags,
  client: Pick<DeployClient, "request">,
  options: { log?: (message: string) => void } = {},
): Promise<void> {
  const log = options.log ?? console.log;
  if ([flags.project, flags.service].some((value) => value !== undefined && !value.trim())) {
    throw new UserError("Service and project names must not be empty.");
  }
  const projects = await client.request<Project[]>("project.all");
  const matches = flags.project
    ? projects.filter((p) => p.projectId === flags.project || p.name === flags.project)
    : projects;
  if (matches.length !== 1) {
    throw new UserError(matches.length === 0
      ? "Project not found. Deploy an application first or check --project <name-or-id>."
      : "More than one project matches. Select one with --project <name-or-id>.");
  }
  const project = matches[0]!;
  const environment = defaultEnvironment(project);
  const applications = environment.applications ?? [];
  const name = flags.service ?? basename(resolve(directory));
  let services = applications.filter((a) => a.applicationId === name || a.name === name);
  if (!flags.service && services.length === 0) services = applications;
  if (services.length !== 1) {
    throw new UserError(services.length === 0
      ? "Service not found. Deploy an application first or check --service <name-or-id>."
      : "More than one service matches. Select one with --service <name-or-id>.");
  }
  const application = services[0]!;
  const link: DirectoryLink = {
    projectId: project.projectId,
    environmentId: environment.environmentId,
    applicationId: application.applicationId,
  };
  const path = join(directory, ".switchyard");
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "link.json"), `${JSON.stringify(link, null, 2)}\n`);
  log(`Linked ${project.name}/${environment.name}/${application.name} (${application.applicationId}).`);
  log("Saved .switchyard/link.json. Add .switchyard/ to your .gitignore.");
}
