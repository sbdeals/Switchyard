"use server";

import { unstable_rethrow } from "next/navigation";
import { compareEnvironments, parseEnvironment } from "../lib/environment-compare";
import { loadComparisonPair } from "../lib/environment-compare-data";

export async function compareEnvironmentsAction(projectId: string, aId: string, bId: string) {
  try {
    const pair = await loadComparisonPair(projectId, aId, bId);
    return { ok: true as const, rows: compareEnvironments(pair.a, pair.b) };
  } catch (e) {
    unstable_rethrow(e);
    // Backend/parser errors may contain configuration values. Never echo them.
    return { ok: false as const, error: "Unable to compare environments. Check access and configuration, then try again." };
  }
}

export async function revealEnvironmentVariableAction(
  projectId: string,
  aId: string,
  bId: string,
  serviceName: string,
  key: string
) {
  try {
    if (typeof serviceName !== "string" || typeof key !== "string") throw new Error("Invalid selection.");
    const pair = await loadComparisonPair(projectId, aId, bId);
    // Recheck the match, including duplicate names, after every authorization.
    const row = compareEnvironments(pair.a, pair.b).find((r) => r.name === serviceName);
    if (!row?.variables.some((v) => v.key === key)) throw new Error("Variable unavailable.");
    const a = parseEnvironment(pair.a.find((s) => s.id === row.a?.id)?.env ?? null);
    const b = parseEnvironment(pair.b.find((s) => s.id === row.b?.id)?.env ?? null);
    return { ok: true as const, a: a.get(key) ?? null, b: b.get(key) ?? null };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false as const, error: "Unable to reveal variable. Compare again and check access." };
  }
}
