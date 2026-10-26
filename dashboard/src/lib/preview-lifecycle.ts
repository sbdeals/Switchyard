import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { after } from "next/server";
import { dispatchComposeHook } from "./deploy-hook-dispatch";
import {
  claimDeployHook, findDeployHook, releaseDeployHook, saveDeployHook, withDeployHookLock,
  type DeployHookRecord,
} from "./deploy-hook-store";
import { bridgeImageDomain, parseManaged, repoStack, withManagedAutoDomain } from "./managed-compose";
import { resolveAppPort } from "./app-port";
import { fetchRepoExposedPorts } from "./repo-port";
import { previewRequest, type PreviewRequest } from "./preview-access";
import { cleanupPreviewContainers } from "./preview-cleanup";
import { PREVIEW_LIMIT, previewDescription, previewEnvironment, type PreviewRecord, type PullRequestEvent } from "./pr-previews";

export interface PreviewCompose {
  composeId: string;
  appName: string;
  name: string;
  description: string | null;
  environmentId: string;
  environment: { projectId: string };
  serverId?: string | null;
  composeFile: string;
  env: string | null;
  refreshToken: string;
  composeStatus?: string;
  domains?: { domainId?: string; host: string; port: number; https: boolean; serviceName: string }[];
}

type Project = {
  environments: { environmentId: string; name: string; compose: { composeId: string; name: string; description: string | null }[] }[];
};

function savePreviewState(hook: DeployHookRecord): void {
  const current = findDeployHook(hook.serviceId);
  if (!current) throw new Error("Preview configuration is unavailable.");
  // Source edits can occur outside the lifecycle lock. Never overwrite them
  // with the snapshot taken before awaiting a management request.
  saveDeployHook({ ...current, previews: hook.previews, previewAccess: hook.previewAccess });
}

const cleanups = new Set<string>();
function scheduleCleanup(serviceId: string, number: number): void {
  const key = `${serviceId}:${number}`;
  if (cleanups.has(key)) return;
  cleanups.add(key);
  try {
    after(async () => {
      try {
        for (let attempt = 0; attempt < 120; attempt++) {
          await delay(5000);
          const finished = await withDeployHookLock(serviceId, async () => {
            const hook = findDeployHook(serviceId);
            if (!hook?.previews?.some((item) => item.number === number && item.deleting)) return true;
            try { return await deleteOwnedPreview(hook, number, previewRequest(hook), false); }
            catch { return false; }
          });
          if (finished) return;
        }
      } finally { cleanups.delete(key); }
    });
  } catch {
    // No request context (or a process restart): the persisted deleting record
    // remains visible for a signed retry or manual Delete preview.
    cleanups.delete(key);
  }
}

export function assertPreviewOwner(hook: DeployHookRecord, preview: PreviewRecord, detail: PreviewCompose): void {
  if (detail.composeId === hook.serviceId || detail.composeId !== preview.serviceId ||
    detail.appName !== preview.appName || detail.name !== preview.name || detail.serverId ||
    detail.environmentId !== preview.environmentId || detail.environment.projectId !== hook.previewAccess?.projectId ||
    detail.description !== previewDescription(hook.serviceId, preview.marker)) throw new Error("Preview ownership changed.");
  if (detail.composeFile) {
    const source = parseManaged(detail.composeFile);
    if (source?.kind !== "repo" || source.preview?.parentId !== hook.serviceId ||
      source.preview.number !== preview.number || source.preview.marker !== preview.marker) throw new Error("Preview ownership changed.");
    let expected = repoStack({ ...source, appName: detail.appName });
    if (source.autoDomain) expected = withManagedAutoDomain(expected, source.autoDomain);
    // An edited stack could mount another service's volumes. Never pass such
    // a file to Dokploy's down --volumes, even when its identity still matches.
    if (expected !== detail.composeFile) throw new Error("Preview configuration changed.");
  }
}

async function project(hook: DeployHookRecord, api: PreviewRequest): Promise<Project> {
  return api<Project>(`project.one?projectId=${encodeURIComponent(hook.previewAccess!.projectId)}`);
}

/** Recover a create whose response was lost using its persisted random marker. */
async function recover(hook: DeployHookRecord, preview: PreviewRecord, api: PreviewRequest): Promise<PreviewCompose | null> {
  const tree = await project(hook, api);
  const environment = tree.environments.find((env) => env.environmentId === preview.environmentId);
  if (!environment) throw new Error("Preview environment is unavailable.");
  const candidates = (preview.serviceId ? tree.environments.flatMap((env) => env.compose) : environment.compose).filter((item) => preview.serviceId
    ? item.composeId === preview.serviceId
    : item.description === previewDescription(hook.serviceId, preview.marker));
  if (candidates.length > 1) throw new Error("Preview ownership is ambiguous.");
  if (!candidates.length) {
    if (preview.serviceId && !preview.deleting) {
      // A service moved to another project must not be mistaken for deletion.
      const detail = await api<PreviewCompose>(`compose.one?composeId=${encodeURIComponent(preview.serviceId)}`);
      assertPreviewOwner(hook, preview, detail);
      throw new Error("Preview project changed.");
    }
    return null;
  }
  const detail = await api<PreviewCompose>(`compose.one?composeId=${encodeURIComponent(candidates[0].composeId)}`);
  if (!preview.serviceId) {
    // Bind only a service created with our persisted marker, never by name.
    const bound = { ...preview, serviceId: detail.composeId, appName: detail.appName };
    assertPreviewOwner(hook, bound, detail);
    Object.assign(preview, bound);
    savePreviewState(hook);
  } else assertPreviewOwner(hook, preview, detail);
  return detail;
}

/** Caller holds the parent lock and has checked owner access or signed the hook. */
export async function deleteOwnedPreview(
  hook: DeployHookRecord, number: number, api = previewRequest(hook), schedule = true,
): Promise<boolean> {
  const preview = hook.previews?.find((item) => item.number === number);
  if (!preview) return true;
  const detail = await recover(hook, preview, api);
  preview.deleting = true;
  savePreviewState(hook);
  if (detail) {
    await api("compose.update", { composeId: detail.composeId, autoDeploy: false });
    await api("compose.cleanQueues", { composeId: detail.composeId });
    const current = await api<PreviewCompose>(`compose.one?composeId=${encodeURIComponent(detail.composeId)}`);
    assertPreviewOwner(hook, preview, current);
    if (current.composeStatus === "running") {
      // Dokploy only cancels waiting jobs. Deleting now could let an active
      // build start a container after cleanup. Never call its global killBuild.
      if (schedule) scheduleCleanup(hook.serviceId, number);
      return false;
    }
    await api("compose.delete", { composeId: detail.composeId, deleteVolumes: true });
  }
  await cleanupPreviewContainers(preview);
  hook.previews = hook.previews!.filter((item) => item.number !== number);
  savePreviewState(hook);
  // A subsequent reopen/close is a new lifecycle even if the head SHA did not
  // change. Keep delivery IDs, but retire this preview's action identities.
  releaseDeployHook(hook.token, (findDeployHook(hook.serviceId)?.recent ?? [])
    .filter((entry) => entry.key.startsWith(`pr:${number}:`)).map((entry) => entry.key));
  if (!hook.previewsEnabled && !hook.previews.length && hook.previewAccess) {
    await api("user.deleteApiKey", { apiKeyId: hook.previewAccess.id });
    delete hook.previewAccess;
    savePreviewState(hook);
  }
  return true;
}

async function upsertPreview(hook: DeployHookRecord, event: PullRequestEvent, api: PreviewRequest): Promise<void> {
  const parent = await api<PreviewCompose>(`compose.one?composeId=${encodeURIComponent(hook.serviceId)}`);
  const source = parseManaged(parent.composeFile);
  if (source?.kind !== "repo" || source.preview || parent.serverId ||
    parent.environment.projectId !== hook.previewAccess?.projectId || source.repoUrl !== hook.repoUrl) {
    throw new Error("Preview parent changed.");
  }
  let preview = hook.previews?.find((item) => item.number === event.number);
  let detail: PreviewCompose;
  if (!preview) {
    const tree = await project(hook, api);
    const environment = tree.environments.find((env) => env.name.toLowerCase() === "preview") ??
      tree.environments.find((env) => env.environmentId === parent.environmentId);
    if (!environment) throw new Error("Preview environment is unavailable.");
    const name = `${parent.name}-pr-${event.number}`;
    if (environment.compose.some((item) => item.name === name)) throw new Error("Preview name is already used.");
    preview = {
      number: event.number, marker: randomUUID(), name, environmentId: environment.environmentId,
      repoUrl: event.repoUrl, branch: event.branch, sha: event.sha, title: event.title,
    };
    hook.previews = [...(hook.previews ?? []), preview];
    savePreviewState(hook); // Reserve capacity and ownership BEFORE the remote write.
    detail = await api<PreviewCompose>("compose.create", {
      name, environmentId: preview.environmentId, composeType: "docker-compose", sourceType: "raw",
      appName: name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40),
      description: previewDescription(hook.serviceId, preview.marker),
    });
    preview.serviceId = detail.composeId;
    preview.appName = detail.appName;
    savePreviewState(hook);
    detail = await api<PreviewCompose>(`compose.one?composeId=${encodeURIComponent(detail.composeId)}`);
    assertPreviewOwner(hook, preview, detail);
  } else {
    if (preview.deleting) throw new Error("Preview deletion is pending.");
    const recovered = await recover(hook, preview, api);
    // A lost create response must not result in a second create. A failed
    // reservation can be removed manually before retrying the event.
    if (!recovered) throw new Error("Preview creation needs recovery in Settings.");
    detail = recovered;
  }
  Object.assign(preview, { repoUrl: event.repoUrl, branch: event.branch, sha: event.sha, title: event.title });
  savePreviewState(hook);
  let composeFile = repoStack({
    appName: detail.appName, repoUrl: event.repoUrl, branch: event.branch, commit: event.sha,
    subdirectory: source.subdirectory, dockerfile: source.dockerfile,
    preview: { parentId: hook.serviceId, number: event.number, marker: preview.marker, title: event.title },
  });
  const env = previewEnvironment(parent.env);
  const port = resolveAppPort({ image: `${detail.appName}-app:latest`, env,
    exposedPorts: await fetchRepoExposedPorts({ ...source, repoUrl: event.repoUrl, branch: event.sha }) });
  let domain = detail.domains?.find((item) => item.serviceName === "app");
  const previousSource = parseManaged(detail.composeFile);
  const auto = previousSource?.kind === "repo" ? previousSource.autoDomain : undefined;
  const manuallyChanged = domain && auto && (auto.host !== domain.host || auto.port !== domain.port);
  if (domain?.domainId && auto?.host === domain.host && auto.port === domain.port && domain.port !== port) {
    await api("domain.update", { domainId: domain.domainId, host: domain.host, port, https: domain.https,
      certificateType: domain.https ? "letsencrypt" : "none", path: "/" });
    domain = { ...domain, port };
  }
  if (!domain) {
    const generated = await api<unknown>("domain.generateDomain", { appName: detail.appName });
    const generatedHost = typeof generated === "string" && /^[A-Za-z0-9.-]+$/.test(generated) ? generated : null;
    const hostIp = process.env.SWITCHYARD_HOST_IP ?? "";
    if (!generatedHost && !/^[0-9.]+$/.test(hostIp)) throw new Error("Preview URL is unavailable.");
    const input = bridgeImageDomain({ appName: detail.appName, hostIp, generatedHost, port });
    await api("domain.create", { ...input, composeId: detail.composeId, serviceName: "app", domainType: "compose" });
    domain = { host: input.host, port, https: input.https ?? false, serviceName: "app" };
  }
  composeFile = withManagedAutoDomain(composeFile, manuallyChanged ? auto : { host: domain.host, port: domain.port });
  await api("compose.update", {
    composeId: detail.composeId, sourceType: "raw", composeType: "docker-compose", isolatedDeployment: false,
    composeFile, autoDeploy: true,
  });
  // Never copy the parent's mounts, domains or compose file.
  await api("compose.saveEnvironment", { composeId: detail.composeId, env });
  preview.url = `${domain.https ? "https" : "http"}://${domain.host}`;
  savePreviewState(hook);
  const current = findDeployHook(hook.serviceId);
  if (!current?.enabled || !current.previewsEnabled || current.token !== hook.token ||
    current.repoUrl !== hook.repoUrl || current.branch !== hook.branch) throw new Error("Preview source changed.");
  await dispatchComposeHook(detail.refreshToken, event.branch, event.sha,
    `PR #${event.number} · ${event.sha.slice(0, 7)} · ${event.title}`);
  preview.lastAction = `${event.action}:${event.sha}`;
  savePreviewState(hook);
}

export async function handlePullRequest(hook: DeployHookRecord, event: PullRequestEvent, delivery: string | null) {
  return withDeployHookLock(hook.serviceId, async () => {
    const current = findDeployHook(hook.serviceId);
    if (!current?.enabled || current.token !== hook.token) return { status: 200, result: "hook changed; delivery ignored" };
    const existing = current.previews?.find((item) => item.number === event.number);
    if (event.action !== "closed") {
      if (!current.previewsEnabled) return { status: 200, result: "PR previews disabled" };
      if (event.fork && !current.allowForks) return { status: 200, result: "fork previews disabled; forks would receive parent env" };
      if (existing?.lastAction === `${event.action}:${event.sha}`) return { status: 200, result: "duplicate action and sha" };
      if (!existing && (current.previews?.length ?? 0) >= PREVIEW_LIMIT) return { status: 429, result: `preview limit reached (${PREVIEW_LIMIT}); close or delete a preview` };
    } else if (!existing) return { status: 200, result: "preview already absent" };
    const keys = [`pr:${event.number}:${event.action}:${event.sha}`];
    if (delivery) keys.push(`delivery:${createHash("sha256").update(delivery).digest("hex")}`);
    if (!claimDeployHook(current.token, keys)) return { status: 200, result: "duplicate or disabled" };
    try {
      const api = previewRequest(current);
      if (event.action === "closed") {
        const deleted = await deleteOwnedPreview(current, event.number, api);
        if (!deleted) return { status: 202, result: "preview cleanup queued; waiting for current build" };
      } else await upsertPreview(current, event, api);
      return { status: 202, result: event.action === "closed" ? "preview deleted" : "preview deployment queued" };
    } catch {
      releaseDeployHook(current.token, keys);
      return { status: 503, result: "preview unavailable; check service Settings and retry" };
    }
  });
}
