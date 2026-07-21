/**
 * Rewrite known database-data host binds in a template's compose file to
 * named volumes.
 *
 * Dokploy templates bind everything under `../files/` — that resolves to
 * /etc/dokploy/compose/<app>/files on the host. On Docker Desktop that path
 * is inside the Linux VM, whose root filesystem does not survive VM
 * recreation (updates, "Reset to factory defaults"), so database data bound
 * there (e.g. supabase's `db/data`) dies with the VM. Named volumes live in
 * the Docker data root and survive. Config-file binds stay as binds: Dokploy
 * rewrites those from its database on every deploy, so they self-heal.
 */

/** Container paths that hold data worth keeping in the template catalog. */
const DATA_TARGETS = [
  "/var/lib/postgresql/data", // postgres
  "/var/lib/mysql", // mysql / mariadb
  "/var/lib/clickhouse", // clickhouse (plausible, ...)
  "/data/db", // mongo
  "/var/lib/storage", // supabase storage-api uploads
];

export interface DataBindRewrite {
  compose: string;
  rewritten: { volume: string; source: string; target: string }[];
}

/**
 * Textual, line-level rewrite of short-syntax bind entries
 * (`- ../files/<path>:<data-target>[:flags]`). Anything it doesn't recognize
 * is left byte-for-byte intact, so an unexpected template shape degrades to
 * the current behavior instead of corrupting the compose file.
 */
export function rewriteDataBindsToVolumes(compose: string): DataBindRewrite {
  const targets = DATA_TARGETS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const bind = new RegExp(
    `^(\\s*-\\s*)(["']?)(\\.\\./files/[^:'"\\s]+):(${targets})((?::[A-Za-z,]+)?)\\2\\s*$`
  );
  const rewritten: DataBindRewrite["rewritten"] = [];
  const bySource = new Map<string, string>();

  const lines = compose.split("\n").map((line) => {
    const m = line.match(bind);
    if (!m) return line;
    const [, indent, , source, target, flags] = m;
    let volume = bySource.get(source);
    if (!volume) {
      volume = volumeNameFor(source);
      bySource.set(source, volume);
      rewritten.push({ volume, source, target });
    }
    return `${indent}${volume}:${target}${flags ?? ""}`;
  });

  if (rewritten.length === 0) return { compose, rewritten };

  // Declare the volumes at the root. Compose prefixes them with the project
  // name (the stack's appName), so they can't collide across stacks.
  const declarations = rewritten.map((r) => `  ${r.volume}:`);
  const root = lines.findIndex((l) => /^volumes:\s*(#.*)?$/.test(l));
  if (root >= 0) {
    lines.splice(root + 1, 0, ...declarations);
  } else {
    if (lines[lines.length - 1]?.trim() !== "") lines.push("");
    lines.push("volumes:", ...declarations);
  }
  return { compose: lines.join("\n"), rewritten };
}

/** `../files/volumes/db/data` -> `data-volumes-db-data` (a valid volume name). */
function volumeNameFor(source: string): string {
  const suffix = source
    .replace(/^\.\.\/files\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `data-${suffix || "dir"}`;
}
