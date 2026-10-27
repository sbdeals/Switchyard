import { STORE_VOLUME } from "./config.js";
import { docker } from "./docker.js";

/** Failed listings are unknown, never evidence that data was removed. */
export async function inspectPurgeResources(): Promise<{ removedVolumes: string[]; error?: string }> {
  const resources = {
    network: ["dokploy-network"],
    secret: ["dokploy_postgres_password", "dokploy_auth_secret"],
    volume: ["dokploy", "dokploy-postgres", "dokploy-redis", STORE_VOLUME],
  };
  const remaining: string[] = [];
  const unverified: string[] = [];
  const removedVolumes: string[] = [];
  for (const [kind, names] of Object.entries(resources)) {
    const res = await docker([kind, "ls", "--format", "{{.Name}}"]);
    if (res.code !== 0) {
      unverified.push(`${kind}: ${names.join(", ")} (${res.stderr.trim() || `exit ${res.code}`})`);
      continue;
    }
    const present = new Set(res.stdout.split(/\r?\n/).map((name) => name.trim()));
    for (const name of names) {
      if (present.has(name)) remaining.push(`${kind}: ${name}`);
      else if (kind === "volume") removedVolumes.push(name);
    }
  }
  if (!remaining.length && !unverified.length) return { removedVolumes };
  const detail = [
    remaining.length ? `Resources still present:\n  ${remaining.join("\n  ")}` : "",
    unverified.length ? `Could not verify removal:\n  ${unverified.join("\n  ")}` : "",
  ].filter(Boolean).join("\n");
  return {
    removedVolumes,
    error: `Purge incomplete.\n${detail}\nResolve the Docker errors and retry \`switchyard down --purge --yes\`.`,
  };
}
