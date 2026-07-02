import type { Platform, SwitchyardConfig } from "../core/config.js";

export interface EnsureDokployOptions {
  force: boolean;
}

export interface DownOptions {
  purge: boolean;
}

/**
 * Per-OS provisioning strategy. Linux drives the repo's canonical bash
 * scripts; Docker Desktop (Windows/macOS) replays the documented Path B
 * steps programmatically. Everything else in `up` is shared.
 */
export interface PlatformModule {
  name: Platform;
  ensureDokploy(
    cfg: SwitchyardConfig,
    opts: EnsureDokployOptions,
    log: (msg: string) => void,
  ): Promise<void>;
  downDokploy(opts: DownOptions, log: (msg: string) => void): Promise<void>;
}
