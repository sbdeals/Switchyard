import { basename, resolve } from "node:path";
import { Command } from "commander";

import { loadConfig, type SwitchyardConfig } from "../core/config.js";
import { packDirectory } from "../core/deploy-pack.js";
import { apiRequest, httpReady, signInCookie, uploadApplication } from "../core/dokploy-api.js";
import { UserError } from "../core/errors.js";
import { defaultEnvironment, linkedApplication, linkedEnvironment, readLink, type Application, type Project } from "../core/link.js";
import { sleep } from "../core/util.js";

export interface DeployFlags {
  service?: string;
  project?: string;
  detach?: boolean;
  includeEnv?: boolean;
}

export interface DeployClient {
  request<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T>;
  upload(applicationId: string, archive: Uint8Array): Promise<void>;
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
    .option("--service <name>", "application name (default: linked service or directory name)")
    .option("--project <name>", "project to reuse or create (default: linked project or the only project)")
    .option("--detach", "return once the upload has queued a deployment")
    .option("--include-env", "allow .env and .env.* files in the upload (ignore rules still apply)")
    .action(action);
}

export async function connectDeployClient(cfg: SwitchyardConfig): Promise<DeployClient> {
  if (!cfg.adminEmail || !cfg.adminPassword) {
    throw new UserError("Not logged in: no Dokploy credentials in the CLI config. Run `switchyard up` to set up your local platform and sign in.");
  }
  const base = `http://localhost:${cfg.dokployPort}`;
  if (!(await httpReady(base))) {
    throw new UserError(`Platform not running: Dokploy is not answering at ${base}. Start it with \`switchyard up\`.`);
  }
  const cookie = await signInCookie(base, cfg.adminEmail, cfg.adminPassword);
  if (!cookie) {
    throw new UserError("Not logged in: Dokploy rejected the configured credentials or stopped answering. Check the platform and sign in again with `switchyard up`.");
  }
  return {
    async request<T>(path: string, init = {}): Promise<T> {
      try {
        return await apiRequest<T>(base, cookie, path, init);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/\(401\)/.test(message)) {
          throw new UserError("Not logged in: the Dokploy session expired. Sign in again with `switchyard up`.");
        }
        throw new UserError(`Deploy request failed: ${message}`);
      }
    },
    upload: (applicationId, archive) => uploadApplication(base, cookie, applicationId, archive),
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
  options: { log?: (message: string) => void; pollIntervalMs?: number; timeoutMs?: number; directory?: string } = {},
): Promise<void> {
  const log = options.log ?? console.log;
  let name = flags.service ?? basename(resolve(path));
  if (!name.trim() || (flags.project !== undefined && !flags.project.trim())) {
    throw new UserError("Service and project names must not be empty.");
  }
  const link = flags.project === undefined ? await readLink(options.directory) : undefined;
  const packed = await packDirectory(path, { includeEnv: flags.includeEnv });
  if (packed.excludedEnvFiles.length > 0) {
    log(`Excluded env files: ${packed.excludedEnvFiles.join(", ")}. Use --include-env to opt in (ignore rules still apply).`);
  }
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
  const linked = link ? linkedEnvironment(projects, link) : undefined;
  const matches = linked ? [linked.project] : flags.project ? projects.filter((p) => p.name === flags.project) : projects;
  if (matches.length > 1) {
    throw new UserError(flags.project
      ? `More than one project is named ${flags.project}; rename duplicates in the dashboard.`
      : "More than one project exists. Select one with --project <name>.");
  }
  let project = matches[0];
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
  const environment = linked?.environment ?? defaultEnvironment(project);
  const linkedService = link && !flags.service ? linkedApplication(environment, link) : undefined;
  const applications = linkedService ? [linkedService] : (environment.applications ?? []).filter((a) => a.name === name);
  if (applications.length > 1) {
    throw new UserError(`More than one application is named ${name} in ${project.name}/${environment.name}; rename duplicates in the dashboard.`);
  }
  const application = applications[0] ?? await client.request<Application>("application.create", {
    method: "POST", body: { name, appName: name, environmentId: environment.environmentId, sourceType: "drop" },
  });
  name = application.name;
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
