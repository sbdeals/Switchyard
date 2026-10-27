"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  databaseAction,
  createProject,
  renameProject,
  removeProject,
  createEnvironment,
  renameEnvironment,
  removeEnvironment,
  listProjects,
  loadWorkspace,
  updateServiceNotes,
  getServiceEnvironment,
  getServiceWebhook,
  getServiceComposeFile,
  getServiceCommands,
  getApplicationSource,
  getServiceDockerImage,
  requireServiceOwnership,
  saveEnvironment,
  updateDatabase,
  reloadDatabase,
  createApplication,
  setAppDockerSource,
  setAppGitSource,
  setAppAutoDeploy,
  rollbackToDeployment,
  setAppGithubSource,
  listGithubProviders,
  listGithubRepositories,
  listGithubBranches,
  githubConnectUrl,
  type GithubProvider,
  type GithubRepository,
  type GithubBranch,
  applicationAction,
  updateApplication,
  saveAppBuildType,
  saveApplicationEnvironment,
  createDomain,
  createComposeDomain,
  ensureAutoDomain,
  generateHostFor,
  updateDomain,
  deleteDomain,
  createRedirect,
  updateRedirect,
  deleteRedirect,
  createPort,
  deletePort,
  createSecurity,
  updateSecurity,
  deleteSecurity,
  assertApplicationAccess,
  createCompose,
  composeAction,
  updateComposeFile,
  saveComposeEnvironment,
  listTemplates,
  deployTemplate,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runSchedule,
  listScheduleExecutions,
  listMounts,
  createMount,
  updateMount,
  removeMount,
  request,
  type Action,
  type DatabasePatch,
  type ApplicationPatch,
  type HealthCheckSwarm,
  type BuildTypePatch,
  type DockerRegistryPatch,
  type DomainInput,
  type Engine,
  type DokployTemplate,
  type Schedule,
  type AppDeployment,
  type CreateScheduleInput,
  type UpdateScheduleInput,
  type Mount,
  type MountServiceType,
  type CreateMountInput,
  type MountPatch,
} from "@/lib/dokploy";
// Backups: S3 destinations + scheduled database backups (see the "backups"
// section below). Kept as a separate import to reduce merge churn.
import {
  listDestinations,
  createDestination,
  testDestination,
  removeDestination,
  listDatabaseBackups,
  createDatabaseBackup,
  updateDatabaseBackup,
  removeDatabaseBackup,
  runDatabaseBackup,
  listBackupFiles,
  restoreBackup,
  type BackupEngine,
  type S3Destination,
  type DatabaseBackup,
  type BackupFile,
  type CreateDestinationInput,
  type CreateBackupInput,
  type UpdateBackupInput,
  type RestoreBackupInput,
} from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
import { randomPassword, randomServiceName } from "@/lib/names";
import { sessionExpiredResult } from "@/lib/session-action-error";
import { readServiceVolumes } from "@/lib/volume-usage.server";
import type { VolumeUsage } from "@/lib/volume-usage";
import { duplicateService } from "@/lib/service-duplicate-operation";
import type { DuplicateServiceRef } from "@/lib/service-duplicate";
import { parseEnvironment, validateCron, validatePort } from "@/lib/validation";
import { updateResourceSettings } from "@/lib/resource-settings";
import type { ResourceInputs } from "@/lib/resource-limits";
import { normalizeServiceNotes } from "@/lib/service-notes";
import { validateComposeFile } from "@/lib/compose-validation";
import { parseAppPort } from "@/lib/app-port";
import { validateMount } from "@/lib/mounts";
import { preserveUrlCredentials } from "@/lib/url-credentials";
import { redactErrorMessage } from "@/lib/error-redaction";
import { validateRedirect, validateBasicAuth } from "@/lib/app-security";

type ActionFailure = { ok: false; error: string; code?: "unauthenticated" };
export type ActionResult = { ok: true } | ActionFailure;
export type QuickDeployResult = { ok: true; id: string } | ActionFailure;
/** Result of the "Generate URL" action: the freshly-attached host on success. */
export type GenerateUrlResult = { ok: true; host: string } | ActionFailure;

function fail(e: unknown): ActionFailure {
  // Keep the editor mounted for auth failures while preserving other redirects.
  const expired = sessionExpiredResult(e);
  if (expired) return expired;
  unstable_rethrow(e);
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

/** Run a mutation, revalidate the page, normalize errors into the result. */
async function wrap(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Backend errors for secret-bearing settings must not echo submitted values. */
async function wrapSensitive(
  fn: () => Promise<unknown>,
  error: string,
  secrets: readonly (string | null | undefined)[] | null = [],
): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    const expired = sessionExpiredResult(e);
    if (expired) return expired;
    unstable_rethrow(e);
    return { ok: false, error: secrets === null ? error : redactErrorMessage(e, error, secrets) };
  }
}

/** Like `wrap`, but returns the created id so the UI can open its drawer. */
async function wrapId(fn: () => Promise<string>): Promise<QuickDeployResult> {
  try {
    const id = await fn();
    revalidatePath("/");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function duplicateServiceAction(
  ref: DuplicateServiceRef,
  name: string,
  environmentId: string
): Promise<QuickDeployResult> {
  return wrapId(() => duplicateService(async (path, init) => {
    try {
      return await request(path, init);
    } catch (error) {
      unstable_rethrow(error);
      // Copies include secrets fetched only on the server. Backend errors may
      // echo any of them, so expose only our own validation/cleanup messages.
      throw new Error("Could not duplicate the service. Please try again.");
    }
  }, ref, name, environmentId, randomUUID()));
}

/** Like `wrap`, but returns the generated host so the UI can surface it. */
async function wrapHost(fn: () => Promise<string>): Promise<GenerateUrlResult> {
  try {
    const host = await fn();
    revalidatePath("/");
    return { ok: true, host };
  } catch (e) {
    return fail(e);
  }
}

/** Resolve a target environment, creating a default project/env if none exist. */
async function resolveTargetEnv(environmentId?: string): Promise<string> {
  if (environmentId) return environmentId;
  const envs = (await listProjects()).flatMap((p) => p.environments);
  if (envs.length > 0) return envs[0].environmentId;
  // No project yet — create one (Dokploy auto-creates a default environment).
  await createProject("My Project");
  const after = (await listProjects()).flatMap((p) => p.environments);
  if (after.length === 0) throw new Error("Could not create a default environment.");
  return after[0].environmentId;
}

/** Resolve ownership and the service type from the current user's workspace. */
export async function saveServiceNotesAction(id: string, notes: string): Promise<ActionResult> {
  try {
    if (typeof id !== "string" || !id.trim() || typeof notes !== "string") {
      throw new Error("Invalid service notes.");
    }
    const { services } = await loadWorkspace();
    const service = services.find((candidate) => candidate.id === id);
    if (!service) throw new Error("Service unavailable.");
    await updateServiceNotes(service, normalizeServiceNotes(notes));
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: "Could not save service notes. Please try again." };
  }
}

// --- databases ----------------------------------------------------------------

/**
 * One-click: provision a database with a random name + password and the latest
 * version, then deploy it.
 */
export async function quickDeployDatabaseAction(
  engine: Engine,
  environmentId?: string
): Promise<QuickDeployResult> {
  return wrapId(async () => {
    const meta = ENGINE_META[engine];
    const id = await createDatabase({
      engine,
      name: randomServiceName(engine),
      environmentId: await resolveTargetEnv(environmentId),
      databasePassword: randomPassword(),
      dockerImage: `${meta.image}:${meta.versions[0]}`,
    });
    await databaseAction(engine, id, "deploy");
    return id;
  });
}

export async function lifecycleAction(
  engine: Engine,
  id: string,
  action: Action
): Promise<ActionResult> {
  return wrap(async () => {
    if (action === "remove") await requireServiceOwnership(engine, id);
    await databaseAction(engine, id, action);
  });
}

/**
 * Patch a database's settings. Image/resource/port changes are applied to the
 * running container with a reload.
 */
export async function updateDatabaseAction(
  engine: Engine,
  id: string,
  appName: string,
  patch: DatabasePatch
): Promise<ActionResult> {
  const secrets = [patch.dockerImage];
  return wrapSensitive(async () => {
    const savedPatch = { ...patch };
    if (typeof savedPatch.dockerImage === "string") {
      savedPatch.dockerImage = preserveUrlCredentials(
        savedPatch.dockerImage, await getServiceDockerImage(engine, id)
      );
      secrets.push(savedPatch.dockerImage);
    } else {
      await requireServiceOwnership(engine, id);
    }
    await updateDatabase(engine, id, savedPatch);
    const needsReload =
      patch.dockerImage !== undefined ||
      patch.cpuLimit !== undefined ||
      patch.memoryLimit !== undefined ||
      patch.externalPort !== undefined;
    if (needsReload) await reloadDatabase(engine, id, appName);
  }, "Could not save database settings.", secrets);
}

export async function saveEnvironmentAction(
  engine: Engine,
  id: string,
  env: string
): Promise<ActionResult> {
  const { error } = parseEnvironment(env);
  if (error) return { ok: false, error };
  return wrap(() => saveEnvironment(engine, id, env));
}

/** Persist resource settings without deploying or reloading a container. */
export async function updateResourcesAction(
  kind: "application" | Engine,
  id: string,
  input: ResourceInputs
): Promise<ActionResult> {
  return wrapSensitive(
    () => updateResourceSettings(kind, id, input),
    "Could not save resource settings.",
  );
}

/** Environment values are fetched only by the open Variables tab. */
export async function loadServiceEnvAction(
  type: MountServiceType,
  id: string
): Promise<{ ok: true; env: string } | { ok: false; error: string }> {
  try {
    return { ok: true, env: await getServiceEnvironment(type, id) };
  } catch (e) {
    const expired = sessionExpiredResult(e);
    if (expired) return expired;
    unstable_rethrow(e);
    return { ok: false, error: "Could not load environment variables." };
  }
}

export async function loadServiceWebhookAction(
  id: string
): Promise<{ ok: true; webhookUrl: string | null } | { ok: false; error: string }> {
  try {
    return { ok: true, webhookUrl: await getServiceWebhook(id) };
  } catch (e) {
    const expired = sessionExpiredResult(e);
    if (expired) return expired;
    unstable_rethrow(e);
    return { ok: false, error: "Could not load webhook URL." };
  }
}

export async function loadComposeFileAction(
  id: string
): Promise<{ ok: true; composeFile: string } | { ok: false; error: string }> {
  try {
    return { ok: true, composeFile: await getServiceComposeFile(id) };
  } catch (e) {
    const expired = sessionExpiredResult(e);
    if (expired) return expired;
    unstable_rethrow(e);
    return { ok: false, error: "Could not load compose file." };
  }
}

export async function loadServiceCommandsAction(
  type: MountServiceType,
  id: string
): Promise<{ ok: true; command: string | null; healthCheckSwarm: HealthCheckSwarm | null } | { ok: false; error: string }> {
  try {
    return { ok: true, ...await getServiceCommands(type, id) };
  } catch (e) {
    const expired = sessionExpiredResult(e);
    if (expired) return expired;
    unstable_rethrow(e);
    return { ok: false, error: "Could not load service commands." };
  }
}

// --- projects & environments ------------------------------------------------

export async function createProjectAction(name: string): Promise<ActionResult> {
  return wrap(() => createProject(name));
}
export async function renameProjectAction(id: string, name: string): Promise<ActionResult> {
  return wrap(() => renameProject(id, name));
}
export async function removeProjectAction(id: string): Promise<ActionResult> {
  return wrap(async () => {
    if (!(await listProjects()).some((project) => project.projectId === id)) {
      throw new Error("Project not found in this workspace.");
    }
    await removeProject(id);
  });
}
export async function createEnvironmentAction(
  projectId: string,
  name: string
): Promise<ActionResult> {
  return wrap(() => createEnvironment(projectId, name));
}
export async function renameEnvironmentAction(id: string, name: string): Promise<ActionResult> {
  return wrap(() => renameEnvironment(id, name));
}
export async function removeEnvironmentAction(id: string): Promise<ActionResult> {
  return wrap(async () => {
    if (!(await listProjects()).some((project) =>
      project.environments.some((environment) => environment.environmentId === id)
    )) {
      throw new Error("Environment not found in this workspace.");
    }
    await removeEnvironment(id);
  });
}

// --- applications -----------------------------------------------------------

/** One-click: create an application from a Docker image and deploy it. */
export async function quickDeployImageAction(
  image: string,
  name?: string,
  environmentId?: string,
  port?: string
): Promise<QuickDeployResult> {
  return wrapId(async () => {
    const trimmed = image.trim();
    if (!trimmed) throw new Error("Image is required.");
    const explicitPort = parseAppPort(port);
    // Derive a friendly name from the image (e.g. "nginx:alpine" -> "nginx").
    const derived = trimmed.split("/").pop()!.split(":")[0];
    const id = await createApplication(
      name?.trim() || randomServiceName(derived),
      await resolveTargetEnv(environmentId)
    );
    await setAppDockerSource(id, trimmed);
    await applicationAction(id, "deploy");
    await mintAutoDomain(id, explicitPort);
    return id;
  });
}

/** Deploy an application from a public Git repository (Nixpacks build). */
export async function quickDeployRepoAction(
  repoUrl: string,
  branch?: string,
  environmentId?: string
): Promise<QuickDeployResult> {
  return wrapId(async () => {
    const url = repoUrl.trim();
    if (!url) throw new Error("Repository URL is required.");
    // Derive a name from the repo (".../my-app.git" -> "my-app").
    const derived = url.replace(/\.git$/, "").split("/").filter(Boolean).pop() || "app";
    const id = await createApplication(
      randomServiceName(derived),
      await resolveTargetEnv(environmentId)
    );
    await setAppGitSource(id, url, branch?.trim() || "main");
    await applicationAction(id, "deploy");
    await mintAutoDomain(id);
    return id;
  });
}

/**
 * Best-effort: give a freshly-deployed app a public URL (no-op off the
 * Linux/Traefik path — see `ensureAutoDomain`). Never fails the deploy over
 * domain creation; the user can always add one in the Domains tab.
 */
async function mintAutoDomain(applicationId: string, port?: number): Promise<void> {
  try {
    await ensureAutoDomain(applicationId, port);
  } catch {
    /* leave the app domain-less rather than failing the deploy */
  }
}

// --- github app (private repos) ---------------------------------------------

export type ListResult<T> = { ok: true; data: T } | { ok: false; error: string };

function listOk<T>(data: T): ListResult<T> {
  return { ok: true, data };
}

/** Configured GitHub App connections + the Dokploy URL to add a new one. */
export async function githubConnectionsAction(): Promise<
  ListResult<{ providers: GithubProvider[]; connectUrl: string }>
> {
  try {
    const providers = await listGithubProviders();
    return listOk({ providers, connectUrl: githubConnectUrl() });
  } catch (e) {
    return fail(e);
  }
}

export async function githubRepositoriesAction(
  githubId: string
): Promise<ListResult<GithubRepository[]>> {
  try {
    return listOk(await listGithubRepositories(githubId));
  } catch (e) {
    return fail(e);
  }
}

export async function githubBranchesAction(
  githubId: string,
  owner: string,
  repo: string
): Promise<ListResult<GithubBranch[]>> {
  try {
    return listOk(await listGithubBranches(githubId, owner, repo));
  } catch (e) {
    return fail(e);
  }
}

/**
 * One-click: create an application pointed at a private repo through a GitHub
 * App installation, then deploy it. A push to `branch` auto-deploys thereafter.
 */
export async function quickDeployGithubAction(input: {
  githubId: string;
  owner: string;
  repository: string;
  branch: string;
  environmentId?: string;
}): Promise<QuickDeployResult> {
  return wrapId(async () => {
    const { githubId, owner, repository, branch } = input;
    if (!githubId || !owner || !repository || !branch)
      throw new Error("Installation, repository and branch are required.");
    const id = await createApplication(
      randomServiceName(repository),
      await resolveTargetEnv(input.environmentId)
    );
    await setAppGithubSource(id, { githubId, owner, repository, branch });
    await applicationAction(id, "deploy");
    await mintAutoDomain(id);
    return id;
  });
}

export async function appLifecycleAction(id: string, action: Action): Promise<ActionResult> {
  return wrap(async () => {
    if (action === "remove") await requireServiceOwnership("application", id);
    await applicationAction(id, action);
  });
}

export async function updateApplicationAction(
  id: string,
  patch: ApplicationPatch,
  redeploy = false
): Promise<ActionResult> {
  // Free-text errors can echo fragments of an inline secret, so these edits
  // retain the generic fallback. Scalar settings keep their validation errors.
  const hasFreeText = Boolean(patch.command || patch.healthCheckSwarm?.Test?.length || patch.description);
  return wrapSensitive(async () => {
    await requireServiceOwnership("application", id);
    await updateApplication(id, patch);
    if (redeploy) await applicationAction(id, "deploy");
  }, "Could not save application settings.", hasFreeText ? null : []);
}

export async function saveApplicationEnvAction(id: string, env: string): Promise<ActionResult> {
  const { error } = parseEnvironment(env);
  if (error) return { ok: false, error };
  return wrap(() => saveApplicationEnvironment(id, env));
}

/** Set an application's build strategy (Nixpacks / Dockerfile / Railpack / …). */
export async function saveAppBuildTypeAction(
  id: string,
  patch: BuildTypePatch,
  redeploy = false
): Promise<ActionResult> {
  return wrap(async () => {
    await saveAppBuildType(id, patch);
    if (redeploy) await applicationAction(id, "deploy");
  });
}

/**
 * Point a docker-image application at an image, optionally with private
 * registry credentials. Empty credentials preserve stored values; clearing
 * credentials requires the explicit clearCredentials flag.
 */
export async function setAppDockerSourceAction(
  id: string,
  dockerImage: string,
  registry?: DockerRegistryPatch,
  redeploy = false
): Promise<ActionResult> {
  const secrets: (string | null | undefined)[] = [registry?.username, registry?.password, registry?.registryUrl];
  return wrapSensitive(async () => {
    const image = dockerImage.trim();
    if (!image) throw new Error("Image is required.");
    secrets.push(dockerImage, image);
    const stored = await getApplicationSource(id);
    secrets.push(stored.dockerImage, stored.registryUrl, stored.username, stored.password);
    const hasCreds = registry && (
      registry.clearCredentials || registry.username || registry.password || registry.registryUrl != null
    );
    await setAppDockerSource(
      id,
      preserveUrlCredentials(image, stored.dockerImage),
      hasCreds ? {
        ...registry,
        registryUrl: registry.registryUrl == null
          ? registry.registryUrl
          : preserveUrlCredentials(registry.registryUrl, stored.registryUrl),
      } : undefined,
      stored
    );
    if (redeploy) await applicationAction(id, "deploy");
  }, "Could not save Docker source.", secrets);
}

export async function createDomainAction(
  applicationId: string,
  input: DomainInput
): Promise<ActionResult> {
  const error = validatePort(input?.port, "Container port");
  if (error) return { ok: false, error };
  return wrap(() => createDomain(applicationId, { ...input, host: input.host.trim() }));
}

export async function updateDomainAction(
  domainId: string,
  input: DomainInput
): Promise<ActionResult> {
  const error = validatePort(input?.port, "Container port");
  if (error) return { ok: false, error };
  return wrap(() => updateDomain(domainId, { ...input, host: input.host.trim() }));
}

export async function deleteDomainAction(domainId: string): Promise<ActionResult> {
  return wrap(() => deleteDomain(domainId));
}

/**
 * Generate + attach a random public URL to an application with zero typing.
 * The host follows the install's auto-URL conventions (`.localhost` on Docker
 * Desktop, `*.traefik.me`/sslip.io on Linux); it is attached on the form's
 * currently-selected `port`. Returns the new host so the UI can highlight it.
 */
export async function generateDomainAction(
  applicationId: string,
  serviceName: string,
  port: number
): Promise<GenerateUrlResult> {
  const error = validatePort(port, "Container port");
  if (error) return { ok: false, error };
  return wrapHost(async () => {
    const g = await generateHostFor(serviceName);
    await createDomain(applicationId, {
      host: g.host,
      port,
      https: g.https,
      certificateType: g.certificateType,
      path: "/",
    });
    return g.host;
  });
}

/** Attach a domain to a compose service. `serviceName` is the compose service to route to. */
export async function createComposeDomainAction(
  composeId: string,
  serviceName: string,
  host: string,
  port: number
): Promise<ActionResult> {
  const error = validatePort(port);
  if (error) return { ok: false, error };
  return wrap(() => createComposeDomain(composeId, serviceName.trim(), host.trim(), port));
}

/**
 * Compose analog of `generateDomainAction`: mint a random host and route it to
 * one service in the stack. `serviceName` is the compose service to target;
 * `labelName` (usually that same service name) seeds the host prefix.
 */
export async function generateComposeDomainAction(
  composeId: string,
  serviceName: string,
  labelName: string,
  port: number
): Promise<GenerateUrlResult> {
  const error = validatePort(port);
  if (error) return { ok: false, error };
  return wrapHost(async () => {
    const g = await generateHostFor(labelName || serviceName);
    await createComposeDomain(composeId, serviceName.trim(), g.host, port, {
      https: g.https,
      certificateType: g.certificateType,
    });
    return g.host;
  });
}

// HTTP settings (applies on next deploy) — Dokploy v0.30.10 shapes.

export async function createRedirectAction(
  applicationId: string,
  regex: string,
  replacement: string,
  permanent: boolean
): Promise<ActionResult> {
  const error = validateRedirect(regex, replacement, permanent);
  if (error) return { ok: false, error };
  return wrap(async () => {
    await assertApplicationAccess(applicationId);
    await createRedirect(applicationId, {
      regex: regex.trim(),
      replacement: replacement.trim(),
      permanent,
    });
  });
}

export async function updateRedirectAction(
  applicationId: string,
  redirectId: string,
  regex: string,
  replacement: string,
  permanent: boolean
): Promise<ActionResult> {
  const error = validateRedirect(regex, replacement, permanent);
  if (error) return { ok: false, error };
  return wrap(async () => {
    await assertApplicationAccess(applicationId, { kind: "redirects", id: redirectId });
    await updateRedirect(redirectId, { regex: regex.trim(), replacement: replacement.trim(), permanent });
  });
}

export async function deleteRedirectAction(applicationId: string, redirectId: string): Promise<ActionResult> {
  return wrap(async () => {
    await assertApplicationAccess(applicationId, { kind: "redirects", id: redirectId });
    await deleteRedirect(redirectId);
  });
}

export async function createPortAction(
  applicationId: string,
  publishedPort: number,
  targetPort: number,
  protocol: "tcp" | "udp",
  publishMode: "host" | "ingress"
): Promise<ActionResult> {
  const error = validatePort(publishedPort, "Published port") || validatePort(targetPort, "Target port");
  if (error) return { ok: false, error };
  return wrap(() => createPort(applicationId, { publishedPort, targetPort, protocol, publishMode }));
}

export async function deletePortAction(portId: string): Promise<ActionResult> {
  return wrap(() => deletePort(portId));
}

export async function createSecurityAction(
  applicationId: string,
  username: string,
  password: string
): Promise<ActionResult> {
  const error = validateBasicAuth(username, password);
  if (error) return { ok: false, error };
  return wrapSecurity(async () => {
    await assertApplicationAccess(applicationId);
    await createSecurity(applicationId, { username: username.trim(), password });
  }, "Could not save basic-auth user.");
}

export async function updateSecurityAction(
  applicationId: string,
  securityId: string,
  username: string,
  password: string
): Promise<ActionResult> {
  const error = validateBasicAuth(username, password);
  if (error) return { ok: false, error };
  return wrapSecurity(async () => {
    await assertApplicationAccess(applicationId, { kind: "security", id: securityId });
    await updateSecurity(securityId, { username: username.trim(), password });
  }, "Could not save basic-auth user.");
}

export async function deleteSecurityAction(applicationId: string, securityId: string): Promise<ActionResult> {
  return wrapSecurity(async () => {
    await assertApplicationAccess(applicationId, { kind: "security", id: securityId });
    await deleteSecurity(securityId);
  }, "Could not remove basic-auth user.");
}

/** Dokploy responses/errors can contain stored passwords; never echo them. */
async function wrapSecurity(fn: () => Promise<unknown>, error: string): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    const expired = sessionExpiredResult(e);
    if (expired) return expired;
    unstable_rethrow(e);
    return { ok: false, error };
  }
}

// --- push-to-deploy + rollback ----------------------------------------------
// (Deploys-tab actions. Kept in their own section so the application actions
//  above stay untouched.)

/**
 * Update a custom-git app's push-to-deploy config: branch, watch paths, and the
 * auto-deploy toggle that gates Dokploy's deploy webhook. `gitUrl`/`buildPath`
 * are re-sent because Dokploy's `saveGitProvider` replaces the whole git config;
 * the client passes the app's current values back. When `gitUrl` is absent the
 * git config is left untouched and only auto-deploy is changed.
 */
export async function updateGitDeployAction(
  applicationId: string,
  config: {
    gitUrl?: string | null;
    branch?: string;
    buildPath?: string;
    watchPaths?: string[];
    autoDeploy: boolean;
  }
): Promise<ActionResult> {
  const secrets = [config.gitUrl];
  return wrapSensitive(async () => {
    const stored = await getApplicationSource(applicationId);
    secrets.push(stored.gitUrl);
    if (config.gitUrl) {
      await setAppGitSource(
        applicationId,
        preserveUrlCredentials(config.gitUrl, stored.gitUrl),
        config.branch?.trim() || "main",
        config.buildPath?.trim() || "/",
        (config.watchPaths ?? []).map((p) => p.trim()).filter(Boolean)
      );
    }
    await setAppAutoDeploy(applicationId, config.autoDeploy);
  }, "Could not save Git deploy settings.", secrets);
}

/**
 * Roll an application back to a past deployment's image snapshot. `rollbackId`
 * comes from a deployment history row (non-null only when that deploy recorded
 * a registry image); see `rollbackToDeployment`.
 */
export async function rollbackDeploymentAction(rollbackId: string): Promise<ActionResult> {
  return wrap(() => rollbackToDeployment(rollbackId));
}

// --- schedules --------------------------------------------------------------

export type SchedulesResult =
  | { ok: true; schedules: Schedule[] }
  | { ok: false; error: string };

/** Load an application's cron schedules (called on demand by the drawer tab). */
export async function listSchedulesAction(applicationId: string): Promise<SchedulesResult> {
  try {
    return { ok: true, schedules: await listSchedules(applicationId) };
  } catch (e) {
    return fail(e);
  }
}

export async function createScheduleAction(input: CreateScheduleInput): Promise<ActionResult> {
  const error = validateCron(input?.cronExpression);
  if (error) return { ok: false, error };
  return wrap(() => createSchedule({ ...input, cronExpression: input.cronExpression.trim() }));
}

export async function updateScheduleAction(
  scheduleId: string,
  input: UpdateScheduleInput
): Promise<ActionResult> {
  const error = validateCron(input?.cronExpression);
  if (error) return { ok: false, error };
  return wrap(() => updateSchedule(scheduleId, { ...input, cronExpression: input.cronExpression.trim() }));
}

export async function deleteScheduleAction(scheduleId: string): Promise<ActionResult> {
  return wrap(() => deleteSchedule(scheduleId));
}

export type ScheduleExecution = Pick<AppDeployment, "deploymentId" | "status" | "createdAt">;
export type ScheduleExecutionsResult =
  | { ok: true; executions: ScheduleExecution[] }
  | { ok: false; error: string };

export async function listScheduleExecutionsAction(scheduleId: string): Promise<ScheduleExecutionsResult> {
  try {
    const executions = await listScheduleExecutions(scheduleId);
    return {
      ok: true,
      executions: executions.map(({ deploymentId, status, createdAt }) => ({
        deploymentId, status, createdAt,
      })),
    };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export type RunScheduleResult = { ok: true; message: string } | { ok: false; error: string };

function scheduleRunResult(status: string | undefined): RunScheduleResult {
  if (status === "error") {
    return {
      ok: false,
      error: "Schedule failed. Make sure the service is running and check the command and shell. See execution history below.",
    };
  }
  return {
    ok: true,
    message: status === "done" ? "Completed — see history below." : "Started — see history below.",
  };
}

export async function runScheduleAction(scheduleId: string): Promise<RunScheduleResult> {
  try {
    // Dokploy can return HTTP 200 with status "error"; surface it.
    const result = await runSchedule(scheduleId);
    revalidatePath("/");
    return scheduleRunResult(result?.status);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// --- compose ----------------------------------------------------------------

/** Create a blank compose stack (seeded with a starter file). */
export async function createComposeAction(
  name?: string,
  environmentId?: string
): Promise<QuickDeployResult> {
  return wrapId(async () =>
    createCompose(name?.trim() || randomServiceName("compose"), await resolveTargetEnv(environmentId))
  );
}

export async function composeLifecycleAction(id: string, action: Action): Promise<ActionResult> {
  return wrap(async () => {
    if (action === "remove") await requireServiceOwnership("compose", id);
    await composeAction(id, action);
  });
}

export async function saveComposeFileAction(
  id: string,
  composeFile: string,
  redeploy = false
): Promise<ActionResult> {
  if (redeploy) {
    const error = validateComposeFile(composeFile, true);
    if (error) return { ok: false, error };
  }
  return wrapSensitive(async () => {
    await updateComposeFile(id, composeFile);
    if (redeploy) await composeAction(id, "deploy");
  }, "Could not save compose file.", null);
}

export async function saveComposeEnvAction(id: string, env: string): Promise<ActionResult> {
  const { error } = parseEnvironment(env);
  if (error) return { ok: false, error };
  return wrap(() => saveComposeEnvironment(id, env));
}

// --- backups ----------------------------------------------------------------
//
// Wraps Dokploy's S3 destinations + per-database scheduled backups. Mutations
// use the shared `wrap()`; the list/read actions return data, so they carry
// their own result shapes (mirroring `wrap`'s error normalization via `fail`).

export type DestinationsResult =
  | { ok: true; destinations: S3Destination[] }
  | { ok: false; error: string };
export type BackupsResult =
  | { ok: true; backups: DatabaseBackup[] }
  | { ok: false; error: string };
export type BackupFilesResult =
  | { ok: true; files: BackupFile[] }
  | { ok: false; error: string };

export async function listDestinationsAction(): Promise<DestinationsResult> {
  try {
    return { ok: true, destinations: await listDestinations() };
  } catch (e) {
    return fail(e);
  }
}

export async function testDestinationAction(
  input: CreateDestinationInput
): Promise<ActionResult> {
  // testConnection is a read-only probe; no revalidation needed but harmless.
  return wrap(() => testDestination(input));
}

export async function createDestinationAction(
  input: CreateDestinationInput
): Promise<ActionResult> {
  return wrap(() => createDestination(input));
}

export async function removeDestinationAction(destinationId: string): Promise<ActionResult> {
  return wrap(async () => {
    if (!(await listDestinations()).some((destination) => destination.destinationId === destinationId)) {
      throw new Error("Destination not found in this workspace.");
    }
    await removeDestination(destinationId);
  });
}

export async function listDatabaseBackupsAction(
  engine: BackupEngine,
  id: string
): Promise<BackupsResult> {
  try {
    return { ok: true, backups: await listDatabaseBackups(engine, id) };
  } catch (e) {
    return fail(e);
  }
}

export async function createDatabaseBackupAction(
  input: CreateBackupInput
): Promise<ActionResult> {
  return wrap(() => createDatabaseBackup(input));
}

export async function updateDatabaseBackupAction(
  input: UpdateBackupInput
): Promise<ActionResult> {
  return wrap(() => updateDatabaseBackup(input));
}

export async function removeDatabaseBackupAction(backupId: string): Promise<ActionResult> {
  return wrap(() => removeDatabaseBackup(backupId));
}

/** Trigger an immediate "back up now" run. */
export async function runDatabaseBackupAction(
  engine: BackupEngine,
  backupId: string
): Promise<ActionResult> {
  return wrap(() => runDatabaseBackup(engine, backupId));
}

export async function listBackupFilesAction(
  destinationId: string,
  search = ""
): Promise<BackupFilesResult> {
  try {
    return { ok: true, files: await listBackupFiles(destinationId, search) };
  } catch (e) {
    return fail(e);
  }
}

/** Restore a backup (destructive — the UI confirms before calling this). */
export async function restoreBackupAction(input: RestoreBackupInput): Promise<ActionResult> {
  return wrap(() => restoreBackup(input));
}

// --- templates (one-click catalog) ------------------------------------------

export type TemplateListResult =
  | { ok: true; templates: DokployTemplate[] }
  | { ok: false; error: string };

/** Fetch Dokploy's one-click template catalog for the New-service menu. */
export async function listTemplatesAction(): Promise<TemplateListResult> {
  try {
    return { ok: true, templates: await listTemplates() };
  } catch (e) {
    return fail(e);
  }
}

/**
 * One-click: provision a catalog template into an environment (Dokploy creates
 * the compose stack from the template) and deploy it, matching the other quick
 * deploys. Returns the new compose service id so the UI can open its drawer.
 */
export async function quickDeployTemplateAction(
  templateId: string,
  environmentId?: string
): Promise<QuickDeployResult> {
  return wrapId(async () => {
    const id = templateId.trim();
    if (!id) throw new Error("Template is required.");
    const composeId = await deployTemplate(id, await resolveTargetEnv(environmentId));
    await composeAction(composeId, "deploy");
    return composeId;
  });
}

// --- mounts (persistent volumes) --------------------------------------------

export type MountsResult = { ok: true; mounts: Mount[]; usage: VolumeUsage[]; usageAvailable: boolean } | { ok: false; error: string };

/** Read-only: the mounts attached to a service (fetched when the tab opens). */
export async function listMountsAction(
  serviceType: MountServiceType,
  serviceId: string
): Promise<MountsResult> {
  try {
    const { services } = await loadWorkspace();
    const service = services.find((s) => s.id === serviceId &&
      (s.kind === "database" ? s.engine : s.kind) === serviceType);
    if (!service) return { ok: false, error: "Unknown service." };
    return { ok: true, ...(await readServiceVolumes(service)) };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: "Could not load mounts." };
  }
}

export async function createMountAction(input: CreateMountInput): Promise<ActionResult> {
  try {
    const mounts = await listMounts(input.serviceType, input.serviceId);
    // Dokploy writes filePath beneath its managed files directory. Never accept
    // a client-supplied source path, or reuse a filename belonging to another mount.
    const mount = {
      type: input.type,
      mountPath: input.mountPath,
      ...(input.type === "volume" ? { volumeName: input.volumeName } : {
        filePath: `${randomUUID()}.conf`,
        content: input.content,
      }),
    };
    const error = validateMount(mount, mounts);
    if (error) return { ok: false, error };
    await createMount({ serviceType: input.serviceType, serviceId: input.serviceId, ...mount });
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: "Could not add mount." };
  }
}

export async function updateMountAction(
  serviceType: MountServiceType,
  serviceId: string,
  mountId: string,
  patch: MountPatch
): Promise<ActionResult> {
  try {
    const mounts = await listMounts(serviceType, serviceId);
    const existing = mounts.find((mount) => mount.mountId === mountId);
    if (!existing || existing.type === "bind" || (patch.type && patch.type !== existing.type)) {
      return { ok: false, error: "Could not update mount." };
    }
    const mount = {
      type: existing.type,
      mountPath: patch.mountPath ?? existing.mountPath,
      ...(existing.type === "volume" ? { volumeName: patch.volumeName ?? existing.volumeName ?? "" } : {
        filePath: existing.filePath ?? "",
        content: patch.content ?? existing.content ?? "",
      }),
    };
    const error = validateMount(mount, mounts, mountId);
    if (error) return { ok: false, error };
    await updateMount(mountId, mount);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: "Could not update mount." };
  }
}

export async function removeMountAction(
  serviceType: MountServiceType,
  serviceId: string,
  mountId: string
): Promise<ActionResult> {
  try {
    const mounts = await listMounts(serviceType, serviceId);
    const mount = mounts.find((mount) => mount.mountId === mountId);
    if (!mount || mount.type === "bind") return { ok: false, error: "Could not remove mount." };
    await removeMount(mountId);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: "Could not remove mount." };
  }
}
