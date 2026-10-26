import type { SwitchyardConfig } from "./config.js";
import { apiRequest, httpReady, signInCookie } from "./dokploy-api.js";
import { UserError } from "./errors.js";

export interface PlatformClient {
  base: string;
  cookie: string;
  request<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T>;
}

/** The same local credentials and per-user Dokploy session for deploy and logs. */
export async function connectPlatformClient(cfg: SwitchyardConfig, signal?: AbortSignal): Promise<PlatformClient> {
  signal?.throwIfAborted();
  if (!cfg.adminEmail || !cfg.adminPassword) {
    throw new UserError("Not logged in: no Dokploy credentials in the CLI config. Run `switchyard up` to set up your local platform and sign in.");
  }
  const base = `http://localhost:${cfg.dokployPort}`;
  const ready = await httpReady(base, signal);
  signal?.throwIfAborted();
  if (!ready) {
    throw new UserError(`Platform not running: Dokploy is not answering at ${base}. Start it with \`switchyard up\`.`);
  }
  const cookie = await signInCookie(base, cfg.adminEmail, cfg.adminPassword, signal);
  signal?.throwIfAborted();
  if (!cookie) {
    throw new UserError("Not logged in: Dokploy rejected the configured credentials or stopped answering. Check the platform and sign in again with `switchyard up`.");
  }
  return {
    base,
    cookie,
    async request<T>(path: string, init = {}): Promise<T> {
      try {
        return await apiRequest<T>(base, cookie, path, { ...init, signal });
      } catch (e) {
        signal?.throwIfAborted();
        const message = e instanceof Error ? e.message : String(e);
        if (/\(401\)/.test(message)) {
          throw new UserError("Not logged in: the Dokploy session expired. Sign in again with `switchyard up`.");
        }
        throw new UserError(`Dokploy request failed: ${message}`);
      }
    },
  };
}
