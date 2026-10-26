import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseManaged } from "./managed-compose";
import { PREVIEW_LIMIT, type PreviewRecord } from "./pr-previews";

export interface DeployHookRecord {
  serviceId: string;
  ownerId: string;
  token: string;
  secret: string;
  enabled: boolean;
  refreshToken: string;
  repoUrl: string;
  branch: string;
  recent?: { key: string; at: number }[];
  previewsEnabled?: boolean;
  allowForks?: boolean;
  previewAccess?: { id: string; sealedKey: string; projectId: string };
  previews?: PreviewRecord[];
}

const DEBOUNCE_MS = 60_000;
const MAX_RECENT = 128;
const MAX_STORE_BYTES = 8 * 1024 * 1024;

function storePath(): string {
  return path.join(process.env.SWITCHYARD_DATA_DIR ?? path.join(process.cwd(), "data"), "deploy-hooks.json");
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validRecord(value: unknown): value is DeployHookRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as DeployHookRecord;
  return boundedString(record.serviceId, 256) && boundedString(record.ownerId, 256) &&
    typeof record.token === "string" && /^[a-f0-9]{64}$/.test(record.token) &&
    typeof record.secret === "string" && /^[a-f0-9]{64}$/.test(record.secret) &&
    typeof record.enabled === "boolean" && boundedString(record.refreshToken, 256) &&
    /^[A-Za-z0-9_-]+$/.test(record.refreshToken) && boundedString(record.repoUrl, 4096) &&
    boundedString(record.branch, 1024) && !("sessionToken" in record) && !("dokployCookie" in record) &&
    (record.previewsEnabled === undefined || typeof record.previewsEnabled === "boolean") &&
    (record.allowForks === undefined || typeof record.allowForks === "boolean") &&
    (record.previewAccess === undefined || (boundedString(record.previewAccess.id, 256) &&
      boundedString(record.previewAccess.sealedKey, 4096) && boundedString(record.previewAccess.projectId, 256))) &&
    (record.previews === undefined || (Array.isArray(record.previews) && record.previews.length <= PREVIEW_LIMIT &&
      new Set(record.previews.map((preview) => preview.number)).size === record.previews.length &&
      record.previews.every((preview) => Number.isSafeInteger(preview.number) && preview.number > 0 &&
        boundedString(preview.marker, 256) && boundedString(preview.name, 1024) &&
        boundedString(preview.environmentId, 256) && boundedString(preview.repoUrl, 4096) &&
        boundedString(preview.branch, 1024) && /^[a-f0-9]{40}$/.test(preview.sha) &&
        typeof preview.title === "string" && preview.title.length <= 240 &&
        (preview.serviceId === undefined || boundedString(preview.serviceId, 256)) &&
        (preview.appName === undefined || /^[a-zA-Z0-9_-]{1,256}$/.test(preview.appName)) &&
        (preview.url === undefined || /^https?:\/\/[A-Za-z0-9.-]+$/.test(preview.url)) &&
        (preview.lastAction === undefined || boundedString(preview.lastAction, 256)) &&
        (preview.deleting === undefined || typeof preview.deleting === "boolean")))) &&
    (record.recent === undefined || (
      Array.isArray(record.recent) && record.recent.length <= MAX_RECENT &&
      record.recent.every((entry) => entry && boundedString(entry.key, 1024) && timestamp(entry.at))
    ));
}

function readStore(): DeployHookRecord[] {
  const file = storePath();
  try {
    if (fs.statSync(file).size > MAX_STORE_BYTES) throw new Error("Store too large");
    const records: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(records) || !records.every(validRecord) ||
      new Set(records.map((record) => record.serviceId)).size !== records.length ||
      new Set(records.map((record) => record.token)).size !== records.length) {
      throw new Error("Invalid store");
    }
    return records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    // Never include parsed data or filesystem errors, which may contain secrets.
    throw new Error("Deploy hook storage is unavailable.");
  }
}

function writeStore(records: DeployHookRecord[]): void {
  const file = storePath();
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const body = JSON.stringify(records);
    if (Buffer.byteLength(body) > MAX_STORE_BYTES) throw new Error("Store too large");
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(file), 0o700);
    fs.writeFileSync(temporary, body, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } catch {
    throw new Error("Deploy hook storage is unavailable.");
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* Best-effort temporary file cleanup. */ }
  }
}

export function findDeployHook(serviceId: string): DeployHookRecord | null {
  return readStore().find((record) => record.serviceId === serviceId) ?? null;
}

export function resolveDeployHook(token: string): DeployHookRecord | null {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return readStore().find((record) => record.token === token && record.enabled) ?? null;
}

export function saveDeployHook(record: DeployHookRecord): void {
  if (!validRecord(record)) throw new Error("Invalid deploy hook configuration.");
  const records = readStore();
  const index = records.findIndex((current) => current.serviceId === record.serviceId);
  if (records.some((current) => current.token === record.token && current.serviceId !== record.serviceId)) {
    throw new Error("Invalid deploy hook configuration.");
  }
  const current = records[index];
  if (current && current.ownerId !== record.ownerId) {
    throw new Error("Invalid deploy hook configuration.");
  }
  const next = { ...record, recent: current?.token === record.token ? current.recent : [] };
  if (index === -1) records.push(next);
  else records[index] = next;
  writeStore(records);
}

/** Keep hook ref checks aligned with Git source edits made in this dashboard. */
export function syncDeployHookSource(serviceId: string, composeFile: string): void {
  const hook = findDeployHook(serviceId);
  if (!hook) return;
  const managed = parseManaged(composeFile);
  if (managed?.kind !== "repo") saveDeployHook({ ...hook, enabled: false });
  else if (managed.repoUrl !== hook.repoUrl || managed.branch !== hook.branch) {
    saveDeployHook({ ...hook, repoUrl: managed.repoUrl, branch: managed.branch });
  }
}

/** Synchronous read/edit/rename is atomic within one dashboard process. */
export function claimDeployHook(token: string, key: string | string[], now = Date.now()): boolean {
  const keys = [...new Set(typeof key === "string" ? [key] : key)];
  if (!keys.length || !keys.every((value) => boundedString(value, 1024)) || !timestamp(now)) return false;
  const records = readStore();
  const record = records.find((current) => current.token === token && current.enabled);
  if (!record) return false;
  const recent = (record.recent ?? []).filter((entry) => entry.at > now - DEBOUNCE_MS);
  if (recent.some((entry) => keys.includes(entry.key)) || recent.length + keys.length > MAX_RECENT) return false;
  record.recent = [...recent, ...keys.map((value) => ({ key: value, at: now }))];
  writeStore(records);
  return true;
}

export function releaseDeployHook(token: string, key: string | string[]): void {
  const keys = typeof key === "string" ? [key] : key;
  const records = readStore();
  const record = records.find((current) => current.token === token);
  if (!record?.recent?.some((entry) => keys.includes(entry.key))) return;
  record.recent = record.recent.filter((entry) => !keys.includes(entry.key));
  writeStore(records);
}

// Settings and preview lifecycle share the same lock. A pending request cannot
// restore a rotated token, exceed the cap, or race deletion with an update.
const updates = new Map<string, Promise<unknown>>();
export async function withDeployHookLock<T>(id: string, update: () => Promise<T>): Promise<T> {
  const previous = updates.get(id) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(update);
  updates.set(id, pending);
  try { return await pending; }
  finally { if (updates.get(id) === pending) updates.delete(id); }
}
