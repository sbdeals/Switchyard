"use server";

import { revalidatePath } from "next/cache";
import {
  createDatabase,
  databaseAction,
  createProject,
  type CreateDatabaseInput,
  type Engine,
} from "@/lib/dokploy";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

/** Create a database, then immediately deploy it. */
export async function createDatabaseAction(input: CreateDatabaseInput): Promise<ActionResult> {
  try {
    await createDatabase(input);
    revalidatePath("/");
    return { ok: true };
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

export async function createProjectAction(name: string): Promise<ActionResult> {
  try {
    await createProject(name);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
