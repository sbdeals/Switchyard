"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { updateDeployTriggers } from "../lib/dokploy";
import { parseDeployTriggers, type DeployTriggerKind } from "../lib/deploy-triggers";
import { previewDeployTriggers } from "../lib/deploy-trigger-preview";

type ActionResult = { ok: true } | { ok: false; error: string };
type PreviewResult =
  | { ok: true; preview: ReturnType<typeof previewDeployTriggers> }
  | { ok: false; error: string };

export async function updateDeployTriggersAction(
  kind: DeployTriggerKind,
  id: string,
  input: unknown
): Promise<ActionResult> {
  try {
    await updateDeployTriggers(kind, id, input);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function previewDeployTriggersAction(
  input: unknown,
  paths: string[]
): Promise<PreviewResult> {
  try {
    const { autoDeploy, watchPaths } = parseDeployTriggers(input);
    return { ok: true, preview: previewDeployTriggers(autoDeploy, watchPaths, paths) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
