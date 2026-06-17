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
  type DatabasePatch,
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
