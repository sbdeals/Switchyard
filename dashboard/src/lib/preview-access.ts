import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { DeployHookRecord } from "./deploy-hook-store";

function key(): Buffer {
  const secret = process.env.SWITCHYARD_SESSION_SECRET;
  if (!secret) throw new Error("Preview encryption is unavailable.");
  return createHash("sha256").update(`switchyard-pr-previews\0${secret}`).digest();
}

export function sealPreviewKey(serviceId: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(serviceId));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function openPreviewKey(hook: DeployHookRecord): string {
  const data = Buffer.from(hook.previewAccess!.sealedKey, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(hook.serviceId));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export type PreviewRequest = <T>(path: string, body?: unknown) => Promise<T>;

/** A separately opted-in automation key, never a retained browser session. */
export function previewRequest(hook: DeployHookRecord): PreviewRequest {
  const apiKey = openPreviewKey(hook);
  // Bound the entire sequence of management requests, not just each fetch.
  const signal = AbortSignal.timeout(5000);
  return async <T>(path: string, body?: unknown): Promise<T> => {
    const base = process.env.DOKPLOY_URL ?? "http://localhost:3000";
    const response = await fetch(new URL(`/api/${path}`, base), {
      method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", credentials: "omit",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: body === undefined ? undefined : JSON.stringify(body), signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error("Preview management is unavailable.");
    }
    return await response.json() as T;
  };
}
