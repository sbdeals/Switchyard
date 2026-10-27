"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { applyDeployOptions } from "../lib/dokploy";
import type { DeployOptionsRequest } from "../lib/deploy-options";
import type { ActionResult } from "./actions";

export async function deployOptionsAction(
  applicationId: string,
  input: DeployOptionsRequest
): Promise<ActionResult> {
  try {
    await applyDeployOptions(applicationId, input);
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: "Could not apply deployment option. Please try again." };
  }
}
