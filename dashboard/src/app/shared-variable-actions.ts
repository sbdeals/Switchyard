"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getSharedVariables, saveSharedVariables } from "@/lib/dokploy";
import type { SharedScope, SharedVariables } from "@/lib/shared-variables";
import type { ActionResult } from "./actions";

export async function getSharedVariablesAction(
  projectId: string,
  environmentId?: string
): Promise<{ ok: true; variables: SharedVariables } | { ok: false; error: string }> {
  try {
    return { ok: true, variables: await getSharedVariables(projectId, environmentId) };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
