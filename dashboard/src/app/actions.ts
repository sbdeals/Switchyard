"use server";

import { revalidatePath } from "next/cache";
import {
  createDatabase,
  databaseAction,
  createProject,
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
  type DatabasePatch,
  type ApplicationPatch,
  type Engine,
} from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
import { randomPassword, randomServiceName } from "@/lib/names";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type QuickDeployResult = { ok: true; id: string } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
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

/**
 * One-click: provision a database with a random name + password and the latest
 * version, then deploy it. Returns the new id so the UI can open its drawer.
 */
export async function quickDeployDatabaseAction(
  engine: Engine,
  environmentId?: string
): Promise<QuickDeployResult> {
  try {
    const meta = ENGINE_META[engine];
    const environment = await resolveTargetEnv(environmentId);
    const id = await createDatabase({
      engine,
      name: randomServiceName(engine),
      environmentId: environment,
      databasePassword: randomPassword(),
      dockerImage: `${meta.image}:${meta.versions[0]}`,
    });
    await databaseAction(engine, id, "deploy");
    revalidatePath("/");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function lifecycleAction(
  engine: Engine,
  id: string,
  action: "deploy" | "start" | "stop" | "remove"
): Promise<ActionResult> {
  try {
    await databaseAction(engine, id, action);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
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
  try {
    await updateDatabase(engine, id, patch);
    const needsReload =
      patch.dockerImage !== undefined ||
      patch.cpuLimit !== undefined ||
      patch.memoryLimit !== undefined ||
      patch.externalPort !== undefined;
    if (needsReload) await reloadDatabase(engine, id, appName);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveEnvironmentAction(
  engine: Engine,
  id: string,
  env: string
): Promise<ActionResult> {
  try {
    await saveEnvironment(engine, id, env);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- applications -----------------------------------------------------------

/** One-click: create an application from a Docker image and deploy it. */
export async function quickDeployImageAction(
  image: string,
  name?: string,
  environmentId?: string
): Promise<QuickDeployResult> {
  try {
    const trimmed = image.trim();
    if (!trimmed) return { ok: false, error: "Image is required." };
    const environment = await resolveTargetEnv(environmentId);
    // Derive a friendly name from the image (e.g. "nginx:alpine" -> "nginx").
    const derived = trimmed.split("/").pop()!.split(":")[0];
    const id = await createApplication(name?.trim() || randomServiceName(derived), environment);
    await setAppDockerSource(id, trimmed);
    await applicationAction(id, "deploy");
    revalidatePath("/");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

/** Deploy an application from a public Git repository (Nixpacks build). */
export async function quickDeployRepoAction(
  repoUrl: string,
  branch?: string,
  environmentId?: string
): Promise<QuickDeployResult> {
  try {
    const url = repoUrl.trim();
    if (!url) return { ok: false, error: "Repository URL is required." };
    const environment = await resolveTargetEnv(environmentId);
    // Derive a name from the repo (".../my-app.git" -> "my-app").
    const derived = url.replace(/\.git$/, "").split("/").filter(Boolean).pop() || "app";
    const id = await createApplication(randomServiceName(derived), environment);
    await setAppGitSource(id, url, branch?.trim() || "main");
    await applicationAction(id, "deploy");
    revalidatePath("/");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function appLifecycleAction(
  id: string,
  action: "deploy" | "start" | "stop" | "remove"
): Promise<ActionResult> {
  try {
    await applicationAction(id, action);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateApplicationAction(
  id: string,
  patch: ApplicationPatch,
  redeploy = false
): Promise<ActionResult> {
  try {
    await updateApplication(id, patch);
    if (redeploy) await applicationAction(id, "deploy");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveApplicationEnvAction(id: string, env: string): Promise<ActionResult> {
  try {
    await saveApplicationEnvironment(id, env);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createDomainAction(
  applicationId: string,
  host: string,
  port: number
): Promise<ActionResult> {
  try {
    await createDomain(applicationId, host.trim(), port);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- compose ----------------------------------------------------------------

/** Create a blank compose stack (seeded with a starter file). */
export async function createComposeAction(
  name?: string,
  environmentId?: string
): Promise<QuickDeployResult> {
  try {
    const environment = await resolveTargetEnv(environmentId);
    const id = await createCompose(name?.trim() || randomServiceName("compose"), environment);
    revalidatePath("/");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function composeLifecycleAction(
  id: string,
  action: "deploy" | "start" | "stop" | "remove"
): Promise<ActionResult> {
  try {
    await composeAction(id, action);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveComposeFileAction(
  id: string,
  composeFile: string,
  redeploy = false
): Promise<ActionResult> {
  try {
    await updateComposeFile(id, composeFile);
    if (redeploy) await composeAction(id, "deploy");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
