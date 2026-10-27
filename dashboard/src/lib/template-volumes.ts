/**
 * Rewrite known database-data host binds in a template's compose file to
 * named volumes.
 *
 * Dokploy templates bind everything under `../files/` — that resolves to
 * /etc/dokploy/compose/<app>/files on the host. On Docker Desktop that path
 * is inside the Linux VM; rebuilding its root filesystem can lose database
 * data bound there (e.g. supabase's `db/data`). Named volumes survive container
 * recreation, Switchyard/Dokploy upgrades, and Docker Desktop restarts, and
 * VM disk recreation only if Docker preserves the volume data. "Reset to
 * factory defaults", "Clean / Purge data", and uninstalling Docker Desktop
 * delete volumes too: named-volume persistence is not a backup. Config-file
 * binds stay as binds: Dokploy rewrites those on every deploy, provided its
 * database survives.
 */
import { createHash } from "node:crypto";

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
  error?: string;
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
  const original = compose.split("\n");
  const rootKey = /^(["']?)volumes\1\s*:/;
  let root = original.findIndex((line) => rootKey.test(line));
  const existing = rootVolumeDeclarations(original, root);
  const used = new Set(existing.keys);
  const rewritten: DataBindRewrite["rewritten"] = [];
  const bySource = new Map<string, string>();

  const lines = original.map((line) => {
    const m = line.match(bind);
    if (!m) return line;
    const [, indent, , source, target, flags] = m;
    let volume = bySource.get(source);
    if (!volume) {
      volume = volumeNameFor(source);
      if (used.has(volume)) {
        const hash = createHash("sha1").update(source).digest("hex").slice(0, 6);
        const hashed = `${volume}-${hash}`;
        volume = hashed;
        // A short hash may itself collide with a declared or generated name.
        for (let i = 2; used.has(volume); i++) volume = `${hashed}-${i}`;
      }
      used.add(volume);
      bySource.set(source, volume);
      rewritten.push({ volume, source, target });
    }
    return `${indent}${volume}:${target}${flags ?? ""}`;
  });

  if (rewritten.length === 0) return { compose, rewritten };

  // Declare the volumes at the root. Compose prefixes them with the project
  // name (the stack's appName), so they can't collide across stacks.
  const declarations = rewritten
    .filter((r) => !existing.keys.includes(r.volume))
    .map((r) => `${existing.indent}${r.volume}:`);
  if (root >= 0) {
    lines.splice(root + 1, 0, ...declarations);
  } else {
    if (lines[lines.length - 1]?.trim() !== "") lines.push("");
    root = lines.length;
    lines.push("volumes:", ...declarations);
  }
  const keys = rootVolumeDeclarations(lines, root).keys;
  if (
    !/^(["']?)volumes\1\s*:\s*(#.*)?$/.test(lines[root]) ||
    lines.filter((line) => rootKey.test(line)).length !== 1 ||
    new Set(keys).size !== keys.length
  ) {
    return {
      compose,
      rewritten: [],
      error: "Template data-volume rewrite skipped: unsupported or duplicate root volume declarations; original Compose preserved.",
    };
  }
  return { compose: lines.join("\n"), rewritten };
}

/** Read direct children only; nested driver options are not volume names. */
function rootVolumeDeclarations(lines: string[], root: number): { keys: string[]; indent: string } {
  const keys: string[] = [];
  let indent: string | undefined;
  for (let i = root + 1; root >= 0 && i < lines.length; i++) {
    const line = lines[i];
    if (/^[^\s#]/.test(line)) break;
    const match = line.match(/^( +)(["']?)([a-zA-Z0-9_.-]+)\2\s*:(?:\s|$)/);
    if (!match) continue;
    if (indent === undefined || match[1].length < indent.length) {
      indent = match[1];
      keys.length = 0;
    }
    if (match[1] === indent) keys.push(match[3]);
  }
  return { keys, indent: indent ?? "  " };
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
