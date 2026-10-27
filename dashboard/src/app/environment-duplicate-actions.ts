"use server";

import { unstable_rethrow } from "next/navigation";
import { duplicateError, prepareEnvironmentDuplicate } from "@/lib/environment-duplicate-server";
import type { DuplicateOptions, DuplicateSummary } from "@/lib/environment-duplicate";

export async function preflightDuplicateEnvironmentAction(options: DuplicateOptions): Promise<
  { ok: true; summary: DuplicateSummary; fingerprint: string } | { ok: false; error: string }
> {
  try {
    const { summary, fingerprint } = await prepareEnvironmentDuplicate(options);
    return { ok: true, summary, fingerprint };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: duplicateError(error) };
  }
}
