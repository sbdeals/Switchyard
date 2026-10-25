"use server";

import { randomBytes } from "node:crypto";
import { deployHookOwner } from "@/lib/deploy-hook-owner";
import { findDeployHook, saveDeployHook, type DeployHookRecord } from "@/lib/deploy-hook-store";
import { request } from "@/lib/dokploy";
import { parseManaged } from "@/lib/managed-compose";

export type DeployHookView = { enabled: boolean; path: string; secret: string };
export type DeployHookResult = { ok: true; hook: DeployHookView | null } | { ok: false; error: string };

function view(hook: DeployHookRecord): DeployHookView {
  return { enabled: hook.enabled, path: `/api/hooks/deploy/${hook.token}`, secret: hook.secret };
}

function ownedHook(serviceId: string, ownerId: string) {
  const hook = findDeployHook(serviceId);
  if (hook && hook.ownerId !== ownerId) throw new Error("Only the owner who configured this hook can manage it.");
  return hook;
}

export async function getDeployHookAction(serviceId: string): Promise<DeployHookResult> {
  try {
    const owner = await deployHookOwner(serviceId);
    const hook = ownedHook(serviceId, owner.ownerId);
    if (!hook) return { ok: true, hook: null };
    return { ok: true, hook: view(hook) };
  } catch {
    // Never echo Dokploy errors, session cookies, or storage contents.
    return { ok: false, error: "Couldn't load this deploy hook. Sign in as its owner with access to this Git service." };
  }
}

// Native token rotation is asynchronous. Serialize per-service settings writes
// so overlapping Enable/Disable/Regenerate actions cannot restore old tokens.
const updates = new Map<string, Promise<unknown>>();
async function updateHook<T>(id: string, update: () => Promise<T>): Promise<T> {
  const previous = updates.get(id) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(update);
  updates.set(id, pending);
  try { return await pending; }
  finally { if (updates.get(id) === pending) updates.delete(id); }
}

export async function updateDeployHookAction(
  serviceId: string,
  operation: "enable" | "disable" | "regenerate"
): Promise<DeployHookResult> {
  try {
    if (!["enable", "disable", "regenerate"].includes(operation)) throw new Error("Invalid operation.");
    const owner = await deployHookOwner(serviceId);
    return await updateHook(serviceId, async () => {
      const hook = ownedHook(serviceId, owner.ownerId);
      if (!hook && operation !== "enable") return { ok: true, hook: null };
      if (hook) saveDeployHook({ ...hook, enabled: false });
      // Revoke the old capability even on Disable. Never leave a stale native
      // URL able to bypass Switchyard after its configuration is changed.
      await request("compose.update", { method: "POST", body: { composeId: serviceId, autoDeploy: false } });
      await request("compose.refreshToken", { method: "POST", body: { composeId: serviceId } });
      const detail = await request<{ composeFile?: string; refreshToken?: string }>(`compose.one?composeId=${encodeURIComponent(serviceId)}`);
      const managed = parseManaged(detail.composeFile);
      if (managed?.kind !== "repo" || !detail.refreshToken) throw new Error("Invalid Git service.");
      const credentials = !hook || operation === "regenerate"
        ? { token: randomBytes(32).toString("hex"), secret: randomBytes(32).toString("hex"), recent: [] }
        : { token: hook.token, secret: hook.secret };
      const updated: DeployHookRecord = {
        ...hook, ...owner, ...credentials, serviceId, refreshToken: detail.refreshToken,
        repoUrl: managed.repoUrl, branch: managed.branch,
        enabled: operation === "regenerate" ? hook!.enabled : operation === "enable",
      };
      if (updated.enabled) {
        await request("compose.update", { method: "POST", body: { composeId: serviceId, autoDeploy: true } });
      }
      saveDeployHook(updated);
      return { ok: true, hook: view(updated) };
    });
  } catch {
    return { ok: false, error: "Couldn't save this deploy hook. Sign in as its owner and check that dashboard data is writable." };
  }
}
