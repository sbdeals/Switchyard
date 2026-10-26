import "server-only";
import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { getDockerSwarmState } from "./docker";
import { getDokployVersion } from "./dokploy";
import { hostModeFromSwarm, type HostCapabilities } from "./host-capabilities";

const CACHE_MS = 30_000;
const UNKNOWN_CACHE_MS = 5_000;
let engineCache: { mode: HostCapabilities["mode"]; expiresAt: number } | undefined;
let engineRead: Promise<HostCapabilities["mode"]> | undefined;
let versionCache: { version: string | null; expiresAt: number } | undefined;

async function readHostMode(): Promise<HostCapabilities["mode"]> {
  if (engineCache && engineCache.expiresAt > Date.now()) return engineCache.mode;
  if (engineRead) return engineRead;
  engineRead = getDockerSwarmState()
    .then(hostModeFromSwarm)
    .catch(() => "unknown" as const)
    .then((mode) => {
      engineCache = { mode, expiresAt: Date.now() + (mode === "unknown" ? UNKNOWN_CACHE_MS : CACHE_MS) };
      return mode;
    })
    .finally(() => {
      engineRead = undefined;
    });
  return engineRead;
}

async function readDokployVersion(): Promise<string | null> {
  if (versionCache && versionCache.expiresAt > Date.now()) return versionCache.version;
  let version: string | null;
  try {
    version = await getDokployVersion();
  } catch (error) {
    // Preserve per-user login redirects and Next.js request-time boundaries.
    unstable_rethrow(error);
    version = null;
  }
  // Cache only public metadata, never a cookie or another user's pending request.
  versionCache = { version, expiresAt: Date.now() + CACHE_MS };
  return version;
}

/** One read per server render, with a short process cache for host metadata. */
export const getHostCapabilities = cache(async (): Promise<HostCapabilities> => {
  const [mode, dokployVersion] = await Promise.all([readHostMode(), readDokployVersion()]);
  return { mode, dokployVersion };
});
