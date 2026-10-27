"use server";

import { sessionExpiredResult } from "@/lib/session-action-error";
import { unstable_rethrow } from "next/navigation";
import { getDatabasePassword, type Engine } from "@/lib/dokploy";

export async function getDatabaseConnectionAction(
  engine: Engine,
  id: string
): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  try {
    return { ok: true, password: await getDatabasePassword(engine, id) };
  } catch (error) {
    const expired = sessionExpiredResult(error);
    if (expired) return expired;
    unstable_rethrow(error);
    return { ok: false, error: "Could not load database credentials. Please try again." };
  }
}
