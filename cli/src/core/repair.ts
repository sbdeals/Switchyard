import type { SwitchyardConfig } from "./config.js";
import { docker } from "./docker.js";
import { apiRequest, signInCookie } from "./dokploy-api.js";

/**
 * Self-heal compose stacks after a Docker Desktop VM reset.
 *
 * Docker Desktop keeps /etc/dokploy inside its Linux VM, and the VM's root
 * filesystem does not survive VM recreation (updates, restarts on some
 * setups, "Reset to factory defaults"). Dokploy regenerates its own Traefik
 * config on boot, but previously-deployed compose stacks are left broken:
 * their working dirs (/etc/dokploy/compose/<app>) are gone, docker auto-creates
 * the missing bind sources as directories the moment a container starts, and
 * `compose up` then reuses those wedged containers ("not a directory" mount
 * errors, config readers crash-looping on a directory where a file belongs).
 *
 * Repair rule: a stack whose last deploy succeeded (composeStatus "done") but
 * that has no RUNNING container — or that has containers stuck in "created"
 * (compose up wedged mid-creation) — is broken. Remove its leftover containers
 * (never its volumes) and ask Dokploy to redeploy; Dokploy rewrites the
 * working dir and template mount files from its database, so the stack comes
 * back exactly as configured. No-op when everything is running.
 */

export interface RepairResult {
  /** Deployed local stacks examined. */
  checked: number;
  /** Stack names that were torn down and redeployed. */
  repaired: string[];
  /** Human-readable descriptions of stacks that could not be repaired. */
  failures: string[];
}

export async function repairComposeStacks(
  cfg: SwitchyardConfig,
  log: (msg: string) => void,
): Promise<RepairResult> {
  const result: RepairResult = { checked: 0, repaired: [], failures: [] };
  if (!cfg.adminEmail || !cfg.adminPassword) return result;

  const base = `http://localhost:${cfg.dokployPort}`;
  const cookie = await signInCookie(base, cfg.adminEmail, cfg.adminPassword);
  // Converge already validated the credentials; a sign-in failure here means
  // something transient — skip quietly rather than failing the install.
  if (cookie === null) return result;

  for (const composeId of collectComposeIds(await apiRequest(base, cookie, "project.all"))) {
    let name = composeId;
    try {
      const one = await apiRequest<Record<string, unknown>>(
        base,
        cookie,
        `compose.one?composeId=${encodeURIComponent(composeId)}`,
      );
      name = typeof one.name === "string" && one.name ? one.name : composeId;
      const appName = typeof one.appName === "string" ? one.appName : "";
      // serverId set = stack lives on a remote Dokploy server; the local
      // docker CLI can't see it, so "no containers" would be a false alarm.
      if (!appName || one.composeStatus !== "done" || one.serverId) continue;
      result.checked++;

      const ps = await docker([
        "ps",
        "-a",
        "--filter",
        `label=com.docker.compose.project=${appName}`,
        "--format",
        "{{.ID}}\t{{.State}}",
      ]);
      if (ps.code !== 0) throw new Error(ps.stderr.trim() || "docker ps failed");
      const rows = parseContainerRows(ps.stdout);
      if (!needsRepair(rows)) continue;

      log(`${name}: last deploy succeeded but its containers are gone or wedged — repairing (Docker VM reset?).`);
      const stale = rows.map((r) => r.id);
      if (stale.length > 0) {
        const rm = await docker(["rm", "-f", ...stale]);
        if (rm.code !== 0) throw new Error(`removing stale containers failed: ${rm.stderr.trim()}`);
      }
      await apiRequest(base, cookie, "compose.redeploy", { method: "POST", body: { composeId } });
      result.repaired.push(name);
    } catch (e) {
      result.failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

export interface ContainerRow {
  id: string;
  state: string;
}

/** Parse `docker ps --format '{{.ID}}\t{{.State}}'` output. */
export function parseContainerRows(stdout: string): ContainerRow[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [id = "", state = ""] = line.split("\t");
      return { id: id.trim(), state: state.trim() };
    })
    .filter((row) => row.id.length > 0);
}

/**
 * Broken = zero running containers (all gone, or only restart-looping /
 * exited leftovers), or any container stuck in "created" — a healthy stack
 * never leaves containers in created state after a successful deploy, while
 * one-shot helpers exiting beside running siblings is normal.
 */
export function needsRepair(rows: ContainerRow[]): boolean {
  const anyRunning = rows.some((row) => row.state === "running");
  const anyCreated = rows.some((row) => row.state === "created");
  return !anyRunning || anyCreated;
}

/**
 * `project.all` nests compose services under project -> environments (and the
 * shape has shifted across Dokploy versions) — walk the whole tree for
 * composeId strings instead of pinning it.
 */
export function collectComposeIds(tree: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.composeId === "string" && record.composeId) ids.add(record.composeId);
    for (const value of Object.values(record)) walk(value);
  };
  walk(tree);
  return [...ids];
}
