"use server";

import { randomBytes } from "node:crypto";
import { deployHookOwner } from "@/lib/deploy-hook-owner";
import { findDeployHook, saveDeployHook, withDeployHookLock, type DeployHookRecord } from "@/lib/deploy-hook-store";
import { request } from "@/lib/dokploy";
import { parseManaged } from "@/lib/managed-compose";
import { sealPreviewKey } from "@/lib/preview-access";
import { deleteOwnedPreview, type PreviewCompose } from "@/lib/preview-lifecycle";
import { githubRepo, type PreviewRecord } from "@/lib/pr-previews";

export type DeployHookView = {
  enabled: boolean; path: string; secret: string;
  previewsEnabled: boolean; allowForks: boolean;
  previews: Pick<PreviewRecord, "number" | "branch" | "title" | "url" | "deleting">[];
};
export type DeployHookResult = { ok: true; hook: DeployHookView | null } | { ok: false; error: string };

function view(hook: DeployHookRecord): DeployHookView {
  return {
    enabled: hook.enabled, path: `/api/hooks/deploy/${hook.token}`, secret: hook.secret,
    previewsEnabled: hook.previewsEnabled ?? false, allowForks: hook.allowForks ?? false,
    previews: (hook.previews ?? []).map(({ number, branch, title, url, deleting }) => ({ number, branch, title, url, deleting })),
  };
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

export async function updateDeployHookAction(
  serviceId: string,
  operation: "enable" | "disable" | "regenerate"
): Promise<DeployHookResult> {
  try {
    if (!["enable", "disable", "regenerate"].includes(operation)) throw new Error("Invalid operation.");
    const owner = await deployHookOwner(serviceId);
    return await withDeployHookLock(serviceId, async () => {
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

export async function updatePreviewSettingsAction(
  serviceId: string, settings: { enabled: boolean; allowForks: boolean },
): Promise<DeployHookResult> {
  try {
    if (typeof settings.enabled !== "boolean" || typeof settings.allowForks !== "boolean") throw new Error("Invalid settings.");
    const owner = await deployHookOwner(serviceId);
    return await withDeployHookLock(serviceId, async () => {
      const hook = ownedHook(serviceId, owner.ownerId);
      if (!hook || (settings.enabled && !hook.enabled)) throw new Error("Enable the deploy hook first.");
      const detail = await request<PreviewCompose>(`compose.one?composeId=${encodeURIComponent(serviceId)}`);
      const managed = parseManaged(detail.composeFile);
      if (managed?.kind !== "repo" || managed.preview || detail.serverId || !githubRepo(managed.repoUrl)) {
        throw new Error("Previews require a local public GitHub bridge service.");
      }
      if (settings.enabled && !hook.previewAccess) {
        // Require encryption before creating a remote credential.
        sealPreviewKey(serviceId, "probe");
        const identity = await request<{ session?: { activeOrganizationId?: string } }>("auth/get-session");
        const organizationId = identity.session?.activeOrganizationId;
        if (!organizationId) throw new Error("Organization is unavailable.");
        const access = await request<{ id: string; key: string }>("user.createApiKey", {
          method: "POST", body: {
            name: `Switchyard PR previews ${serviceId}`.slice(0, 32), metadata: { organizationId }, rateLimitEnabled: false,
          },
        });
        try {
          hook.previewAccess = {
            id: access.id, sealedKey: sealPreviewKey(serviceId, access.key), projectId: detail.environment.projectId,
          };
          saveDeployHook(hook);
        } catch {
          await request("user.deleteApiKey", { method: "POST", body: { apiKeyId: access.id } });
          throw new Error("Preview access could not be saved.");
        }
      }
      hook.previewsEnabled = settings.enabled;
      hook.allowForks = settings.allowForks;
      saveDeployHook(hook);
      // Keep authorization for signed close events while previews still exist.
      if (!settings.enabled && !hook.previews?.length && hook.previewAccess) {
        await request("user.deleteApiKey", { method: "POST", body: { apiKeyId: hook.previewAccess.id } });
        delete hook.previewAccess;
        saveDeployHook(hook);
      }
      return { ok: true, hook: view(hook) };
    });
  } catch {
    return { ok: false, error: "Couldn't save PR previews. Sign in as the hook owner with API access to this local GitHub service." };
  }
}

export async function deletePreviewAction(serviceId: string, number: number): Promise<DeployHookResult> {
  try {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid preview.");
    const owner = await deployHookOwner(serviceId);
    return await withDeployHookLock(serviceId, async () => {
      const hook = ownedHook(serviceId, owner.ownerId);
      if (!hook) throw new Error("Missing hook.");
      // Manual cleanup uses the current owner's permission, even if the
      // automation key has been revoked or the webhook has been disabled.
      await deleteOwnedPreview(hook, number, (path, body) => request(path, body === undefined ? {} : { method: "POST", body }));
      return { ok: true, hook: view(hook) };
    });
  } catch {
    return { ok: false, error: "Couldn't delete this preview. Check owner access and preview ownership, then retry." };
  }
}
