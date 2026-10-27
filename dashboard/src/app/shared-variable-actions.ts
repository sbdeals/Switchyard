"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getSharedVariables, getSharedVariableKeys, saveSharedVariables } from "@/lib/dokploy";
import type { SharedScope, SharedVariables, SharedVariableKeys } from "@/lib/shared-variables";
import type { ActionResult } from "./actions";

export async function getSharedVariablesAction(
  projectId: string,
  environmentId?: string
): Promise<{ ok: true; variables: SharedVariables } | { ok: false; error: string }> {
  try {
    return { ok: true, variables: await getSharedVariables(projectId, environmentId) };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: "Could not load shared variables." };
  }
}

/** Names only for service reference pickers and Defined/Missing badges. */
export async function getSharedVariableKeysAction(
  projectId: string,
  environmentId?: string
): Promise<{ ok: true; keys: SharedVariableKeys } | { ok: false; error: string }> {
  try {
    return { ok: true, keys: await getSharedVariableKeys(projectId, environmentId) };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: "Could not load shared variables." };
  }
}

export async function saveSharedVariablesAction(
  projectId: string,
  environmentId: string | undefined,
  scope: SharedScope,
  env: string
): Promise<ActionResult> {
  try {
    await saveSharedVariables(projectId, environmentId, scope, env);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: "Could not save shared variables." };
  }
}
