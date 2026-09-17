/**
 * Where one-click services run on this host.
 *
 * - "swarm":  the engine's native path (Swarm services on the overlay
 *             `dokploy-network`) — the normal case.
 * - "bridge": `docker compose` projects attached to a local bridge
 *             `dokploy-network`. Used when Swarm services can't be scheduled:
 *             Swarm refuses non-overlay networks ("network dokploy-network
 *             cannot be used with services"), which is exactly the setup on
 *             hosts whose kernel lacks VXLAN.
 *
 * Detection is a side-effect-free inspect of `dokploy-network`: overlay means
 * Swarm services can attach, anything else means they can't. Hosts where the
 * network IS overlay but VXLAN still fails at join time can force the bridge
 * path with SWITCHYARD_DEPLOY_TARGET=bridge.
 */
import "server-only";
import { inspectNetwork } from "./docker";
import { BRIDGE_NETWORK } from "./managed-compose";

export type DeployTarget = "swarm" | "bridge";

const CACHE_MS = 60_000;
let cached: { at: number; target: DeployTarget } | null = null;

export async function deployTarget(): Promise<DeployTarget> {
  const forced = process.env.SWITCHYARD_DEPLOY_TARGET;
  if (forced === "swarm" || forced === "bridge") return forced;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.target;
  let target: DeployTarget = "swarm";
  try {
    const net = await inspectNetwork(BRIDGE_NETWORK);
    // Missing network: nothing to decide from — keep the engine's default.
    if (net && net.driver !== "overlay") target = "bridge";
  } catch {
    // Docker socket unavailable: keep the engine's default path.
  }
  cached = { at: Date.now(), target };
  return target;
}
