"use server";

import { unstable_rethrow } from "next/navigation";
import { getDatabasePassword, type Engine } from "@/lib/dokploy";

/** Credentials are fetched only by an open database connection/password view. */
export async function loadDatabaseCredentialsAction(
  engine: Engine,
  id: string,
): Promise<{ ok: true; password: string | null } | { ok: false; error: string }> {
  try {
    return { ok: true, password: await getDatabasePassword(engine, id) };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: "Could not load database credentials." };
  }
}
