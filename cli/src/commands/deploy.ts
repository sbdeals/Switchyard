import { basename, resolve } from "node:path";
import { Command } from "commander";

import { loadConfig, type SwitchyardConfig } from "../core/config.js";
import { packDirectory } from "../core/deploy-pack.js";
import { uploadApplication } from "../core/dokploy-api.js";
import { UserError } from "../core/errors.js";
import { connectPlatformClient } from "../core/platform-client.js";
import { findService, selectEnvironment, selectProject, type Project } from "../core/service-selection.js";
import { sleep } from "../core/util.js";

export interface DeployFlags {
  service?: string;
  project?: string;
  detach?: boolean;
}

export interface DeployClient {
  request<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T>;
  upload(applicationId: string, archive: Uint8Array): Promise<void>;
}

interface Application {
  applicationId: string;
  name: string;
  domains?: { host: string; https?: boolean; path?: string | null }[];
}

interface Deployment {
  deploymentId: string;
  status: string;
  errorMessage?: string | null;
}

export function createDeployCommand(
  action: (path: string, flags: DeployFlags) => Promise<void> = deployCommand,
): Command {
  return new Command("deploy")
    .description("Deploy a directory to Dokploy (the Railway up equivalent)")
    .argument("[path]", "directory to deploy", ".")
    .option("--service <name|id>", "application to reuse or create (default: directory name)")
    .option("--project <name|id>", "project to reuse or create (default: the only project)")
    .option("--detach", "return once the upload has queued a deployment")
    .action(action);
}

export async function connectDeployClient(cfg: SwitchyardConfig): Promise<DeployClient> {
  const client = await connectPlatformClient(cfg);
  return {
    request: client.request,
    upload: (applicationId, archive) => uploadApplication(client.base, client.cookie, applicationId, archive),
  };
}

export async function deployCommand(path: string, flags: DeployFlags): Promise<void> {
  const { config } = loadConfig();
  await deployDirectory(path, flags, await connectDeployClient(config));
}

/** Kept separate from auth/argument parsing so the full API sequence is testable. */
export async function deployDirectory(
  path: string,
  flags: DeployFlags,
  client: DeployClient,
  options: { log?: (message: string) => void; pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const log = options.log ?? console.log;
  const name = flags.service ?? basename(resolve(path));
  if (!name.trim() || (flags.project !== undefined && !flags.project.trim())) {
    throw new UserError("Service and project names must not be empty.");
  }
  const packed = await packDirectory(path);
  const nixpacksFiles = ["package.json", "requirements.txt", "pyproject.toml", "Pipfile", "go.mod"];
  const buildType = packed.hasDockerfile ? "dockerfile" : "nixpacks";
  if (!packed.hasDockerfile && !nixpacksFiles.some((file) => packed.files.includes(file))) {
    throw new UserError("No Dockerfile or supported buildpack manifest in the packed directory. Add a root Dockerfile, or a Node.js, Python, or Go manifest for Nixpacks; check your ignore rules.");
  }
  log(`Packed ${packed.files.length} files (${packed.archive.length} bytes); build: ${buildType}.`);
  if (packed.skippedSymlinks.length > 0) {
    log(`Skipped ${packed.skippedSymlinks.length} symbolic link(s); include real files if the build needs them.`);
  }

  let projects = await client.request<Project[]>("project.all");
  let project = selectProject(projects, flags.project);
  if (!project) {
    const projectName = flags.project ?? "Default";
    const created = await client.request<{ project: { projectId: string } }>("project.create", {
      method: "POST", body: { name: projectName },
    });
    // Dokploy creates a production environment with each project.
    projects = await client.request<Project[]>("project.all");
    project = projects.find((p) => p.projectId === created.project.projectId);
    if (!project) throw new UserError(`Created project ${projectName}, but Dokploy did not return its environment. Check the dashboard.`);
  }
  const environment = selectEnvironment(project);
  const existing = findService(project, environment, name, ["application"]);
  const application = existing ? { applicationId: existing.serviceId } : await client.request<Application>("application.create", {
    method: "POST", body: { name, appName: name, environmentId: environment.environmentId, sourceType: "drop" },
  });
  const { applicationId } = application;
  const deploymentPath = `deployment.all?applicationId=${encodeURIComponent(applicationId)}`;
  const previous = await client.request<Deployment[]>(deploymentPath);
  if (previous.some((d) => d.status === "running")) {
    throw new UserError(`${name} already has a running deployment. Wait for it to finish before uploading another directory.`);
  }
  const previousIds = new Set(previous.map((d) => d.deploymentId));
  log(`Deploying ${project.name}/${environment.name}/${name} (${applicationId}).`);
  await client.request("application.update", {
    method: "POST",
    body: {
      applicationId,
      buildType,
      ...(packed.hasDockerfile ? { dockerfile: "Dockerfile", dockerContextPath: ".", dockerBuildStage: null } : {}),
    },
  });
  // v0.30.10 dropDeployment switches the source to drop AND queues the deploy.
  await client.upload(applicationId, packed.archive);
  log("Upload accepted; deployment queued.");

  if (!flags.detach) {
    const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
    let trackedId: string | undefined;
    let lastStatus: string | undefined;
    for (;;) {
      const deployments = await client.request<Deployment[]>(deploymentPath);
      const fresh = deployments.filter((d) => !previousIds.has(d.deploymentId));
      if (!trackedId && fresh.length > 1) {
        throw new UserError(`Multiple deployments appeared for ${name}; check the dashboard to identify this upload.`);
      }
      trackedId ??= fresh[0]?.deploymentId;
      const deployment = fresh.find((d) => d.deploymentId === trackedId);
      if (deployment && deployment.status !== lastStatus) {
        log(`Deployment ${deployment.deploymentId}: ${deployment.status}`);
        lastStatus = deployment.status;
      }
      if (deployment?.status === "done") break;
      if (deployment?.status === "error" || deployment?.status === "cancelled") {
        throw new UserError(`Deployment ${deployment.deploymentId} failed (${deployment.status})${deployment.errorMessage ? `: ${deployment.errorMessage}` : ". Check its build logs in the dashboard."}`);
      }
      if (Date.now() >= deadline) {
        throw new UserError(`Timed out waiting for deployment${trackedId ? ` ${trackedId}` : " to start"}. It may still be running; check the dashboard. Use --detach to return after upload.`);
      }
      await sleep(options.pollIntervalMs ?? 2000);
    }
  }
  const detail = await client.request<Application>(`application.one?applicationId=${encodeURIComponent(applicationId)}`);
  for (const domain of detail.domains ?? []) {
    log(`URL: ${domain.https ? "https" : "http"}://${domain.host}${domain.path ?? ""}`);
  }
  if (!detail.domains?.length) log("No domain configured. Add one in the dashboard to expose this application.");
}
