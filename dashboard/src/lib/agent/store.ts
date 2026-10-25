/**
 * In-memory store of "staged" (pending-approval) changes the agent has queued
 * but not yet executed. Destructive operations (delete/stop a service, delete a
 * domain or mount) and ALL shell commands land here instead of executing.
 * They wait for approval in the existing changes bar.
 *
 * The store is a process-global singleton so it survives Next.js HMR reloads and
 * repeated imports (same pattern as lib/collector.ts). It is keyed per user so
 * two people driving the same dashboard don't see each other's queued changes.
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";

import type { SwitchyardSession } from "@/lib/session";

/** The kinds of operation that must be staged rather than executed. */
export type StagedKind = "delete_service" | "stop_service" | "delete_domain" | "delete_mount" | "exec_in_service";

export interface ShellCommand {
  serviceId: string;
  serviceName: string;
  appName: string;
  containerId: string;
  workingDir: string;
  command: string;
}

type StagedOperation =
  | { kind: "exec_in_service"; params: ShellCommand }
  | { kind: Exclude<StagedKind, "exec_in_service">; params: Record<string, unknown> };

export type StagedChange = StagedOperation & {
  id: string;
  /** Human-readable one-liner shown in the Apply bar / details modal. */
  description: string;
  createdAt: number;
};

interface StagedRuntime {
  /** sessionKey -> ordered list of staged changes. */
  byKey: Map<string, StagedChange[]>;
}

const g = globalThis as unknown as { __switchyardAgentStaged?: StagedRuntime };
const rt: StagedRuntime =
  g.__switchyardAgentStaged ?? (g.__switchyardAgentStaged = { byKey: new Map() });

/**
 * Derive a stable per-login key from the VERIFIED session — the opened seal
 * (`sessionFromRequest`), never the raw cookie header, which a caller could
 * vary by re-encoding it. The Dokploy session token is hashed so the raw value
 * is never used as a map key. Two browsers signed into the same account hold
 * different Dokploy sessions and therefore separate queues, matching the
 * per-browser agent conversation that produced the changes.
 */
export function sessionKey(session: SwitchyardSession): string {
  return createHash("sha256").update(session.dokployCookie).digest("hex").slice(0, 32);
}

export function listStaged(key: string): StagedChange[] {
  return structuredClone(rt.byKey.get(key) ?? []);
}

export function addStaged(
  key: string,
  entry: StagedOperation & { description: string }
): StagedChange {
  const change: StagedChange = {
    ...structuredClone(entry),
    id: `chg_${randomUUID()}`,
    createdAt: Date.now(),
  };
  const list = rt.byKey.get(key) ?? [];
  list.push(change);
  rt.byKey.set(key, list);
  return structuredClone(change);
}

/** Atomically consume exactly the reviewed ids, before any asynchronous work. */
export function takeStaged(key: string, ids: string[]): StagedChange[] {
  const list = rt.byKey.get(key) ?? [];
  if (ids.some((id) => !list.some((change) => change.id === id))) {
    throw new Error("A change is no longer pending. Refresh and review the pending changes again.");
  }
  return removeStaged(key, ids);
}

/** Remove changes by id (or all when `ids` is undefined). Returns removed ones. */
export function removeStaged(key: string, ids?: string[]): StagedChange[] {
  const list = rt.byKey.get(key) ?? [];
  if (!ids) {
    rt.byKey.set(key, []);
    return list;
  }
  const idSet = new Set(ids);
  const removed = list.filter((c) => idSet.has(c.id));
  rt.byKey.set(
    key,
    list.filter((c) => !idSet.has(c.id))
  );
  return removed;
}
