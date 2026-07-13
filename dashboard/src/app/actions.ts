"use server";

import { revalidatePath } from "next/cache";
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
  saveEnvironment,
  updateDatabase,
  reloadDatabase,
  createApplication,
  setAppDockerSource,
  setAppGitSource,
  applicationAction,
  updateApplication,
  saveApplicationEnvironment,
  createDomain,
  createCompose,
  composeAction,
  updateComposeFile,
  listTemplates,
  deployTemplate,
  type Action,
  type DatabasePatch,
  type ApplicationPatch,
  type Engine,
  type DokployTemplate,
} from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
import { randomPassword, randomServiceName } from "@/lib/names";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type QuickDeployResult = { ok: true; id: string } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
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
  return wrap(() => databaseAction(engine, id, action));
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
  return wrap(async () => {
    await updateDatabase(engine, id, patch);
    const needsReload =
      patch.dockerImage !== undefined ||
      patch.cpuLimit !== undefined ||
      patch.memoryLimit !== undefined ||
      patch.externalPort !== undefined;
    if (needsReload) await reloadDatabase(engine, id, appName);
  });
}

export async function saveEnvironmentAction(
  engine: Engine,
  id: string,
  env: string
): Promise<ActionResult> {
  return wrap(() => saveEnvironment(engine, id, env));
}

// --- projects & environments ------------------------------------------------

export async function createProjectAction(name: string): Promise<ActionResult> {
  return wrap(() => createProject(name));
}
export async function renameProjectAction(id: string, name: string): Promise<ActionResult> {
  return wrap(() => renameProject(id, name));
}
export async function removeProjectAction(id: string): Promise<ActionResult> {
  return wrap(() => removeProject(id));
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
  return wrap(() => removeEnvironment(id));
}

// --- applications -----------------------------------------------------------

/** One-click: create an application from a Docker image and deploy it. */
export async function quickDeployImageAction(
  image: string,
  name?: string,
  environmentId?: string
): Promise<QuickDeployResult> {
  return wrapId(async () => {
    const trimmed = image.trim();
    if (!trimmed) throw new Error("Image is required.");
    // Derive a friendly name from the image (e.g. "nginx:alpine" -> "nginx").
    const derived = trimmed.split("/").pop()!.split(":")[0];
    const id = await createApplication(
      name?.trim() || randomServiceName(derived),
      await resolveTargetEnv(environmentId)
    );
    await setAppDockerSource(id, trimmed);
    await applicationAction(id, "deploy");
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
    return id;
  });
}

export async function appLifecycleAction(id: string, action: Action): Promise<ActionResult> {
  return wrap(() => applicationAction(id, action));
}

export async function updateApplicationAction(
  id: string,
  patch: ApplicationPatch,
  redeploy = false
): Promise<ActionResult> {
  return wrap(async () => {
    await updateApplication(id, patch);
    if (redeploy) await applicationAction(id, "deploy");
  });
}

export async function saveApplicationEnvAction(id: string, env: string): Promise<ActionResult> {
  return wrap(() => saveApplicationEnvironment(id, env));
}

export async function createDomainAction(
  applicationId: string,
  host: string,
  port: number
): Promise<ActionResult> {
  return wrap(() => createDomain(applicationId, host.trim(), port));
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
  return wrap(() => composeAction(id, action));
}

export async function saveComposeFileAction(
  id: string,
  composeFile: string,
  redeploy = false
): Promise<ActionResult> {
  return wrap(async () => {
    await updateComposeFile(id, composeFile);
    if (redeploy) await composeAction(id, "deploy");
  });
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
