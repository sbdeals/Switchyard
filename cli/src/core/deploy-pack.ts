import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join, posix } from "node:path";
import { deflateRawSync } from "node:zlib";

import { UserError } from "./errors.js";

export const DEFAULT_DEPLOY_MAX_BYTES = 100 * 1024 * 1024;

interface IgnoreRule {
  base: string;
  pattern: RegExp;
  negate: boolean;
  directoryOnly: boolean;
}

export interface PackedDirectory {
  archive: Buffer;
  files: string[];
  totalBytes: number;
  hasDockerfile: boolean;
  skippedSymlinks: string[];
}

function glob(pattern: string): string {
  let result = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\") {
      if (++i === pattern.length) return "(?!)";
      result += pattern[i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "*") {
      if (pattern[i + 1] === "*" && (i === 0 || pattern[i - 1] === "/") &&
        (i + 2 === pattern.length || pattern[i + 2] === "/")) {
        i++;
        if (pattern[i + 1] === "/") {
          result += "(?:.*/)?";
          i++;
        } else result += ".*";
      } else result += "[^/]*";
    } else if (c === "?") result += "[^/]";
    else if (c === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) result += "\\[";
      else {
        const chars = pattern.slice(i + 1, end).replace(/^!/, "^");
        result += `(?!/)[${chars}]`;
        i = end;
      }
    } else result += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return result;
}

function ignoreRules(text: string, base: string, docker: boolean): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (let line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (line.startsWith("#")) continue;
    line = docker ? line.trim() : line.replace(/(?<!\\) +$/, "");
    if (!line) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const directoryOnly = !docker && line.endsWith("/");
    const anchored = docker || line.startsWith("/") || line.replace(/\/$/, "").includes("/");
    if (docker) line = posix.normalize(line);
    line = line.replace(/^\//, "").replace(/\/$/, "");
    if (!line || line === ".") continue;
    try {
      rules.push({ base, negate, directoryOnly, pattern: new RegExp(`${anchored ? "^" : "(?:^|/)"}${glob(line)}$`) });
    } catch {
      throw new UserError(`Invalid ignore pattern: ${line}`);
    }
  }
  return rules;
}

function ignored(path: string, directory: boolean, rules: IgnoreRule[]): boolean {
  let excluded = false;
  for (const rule of rules) {
    if (!path.startsWith(rule.base)) continue;
    const relative = path.slice(rule.base.length);
    const parts = relative.split("/");
    for (let i = 1; i <= parts.length; i++) {
      if (rule.directoryOnly && i === parts.length && !directory) continue;
      if (rule.pattern.test(parts.slice(0, i).join("/"))) {
        excluded = !rule.negate;
        break;
      }
    }
  }
  return excluded;
}

function tooLarge(maxBytes: number): UserError {
  return new UserError(`Deployment upload too large: source files and ZIP must each fit within ${maxBytes} bytes (${(maxBytes / 1024 / 1024).toFixed(1)} MiB). Exclude files with .gitignore or .dockerignore.`);
}

async function readBounded(path: string, limit: number, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new UserError(`Cannot pack non-regular file: ${path}`);
    if (stat.size > limit) throw tooLarge(maxBytes);
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit - size + 1));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw tooLarge(maxBytes);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
}

async function readIgnore(path: string, maxBytes: number): Promise<string | null> {
  try {
    if (!(await lstat(path)).isFile()) return null;
    return (await readBounded(path, maxBytes, maxBytes)).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Root-relative ZIP for Dokploy's dropDeployment; no external archiver required. */
export async function packDirectory(path: string, { maxBytes = DEFAULT_DEPLOY_MAX_BYTES }: { maxBytes?: number } = {}): Promise<PackedDirectory> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 22 || maxBytes > DEFAULT_DEPLOY_MAX_BYTES) {
    throw new UserError(`Archive size limit must be between 22 and ${DEFAULT_DEPLOY_MAX_BYTES} bytes.`);
  }
  let root: string;
  try {
    root = await realpath(path);
    if (!(await lstat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new UserError(`Deployment path is not a readable directory: ${path}`);
  }
  const dockerIgnore = await readIgnore(join(root, "Dockerfile.dockerignore"), maxBytes) ??
    await readIgnore(join(root, ".dockerignore"), maxBytes) ?? "";
  const dockerRules = ignoreRules(dockerIgnore, "", true);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const files: string[] = [];
  const skippedSymlinks: string[] = [];
  let totalBytes = 0;
  let localSize = 0;
  let centralSize = 0;
  let entryCount = 0;

  function addEntry(name: string, data: Buffer, mode: number, directory = false): void {
    const filename = Buffer.from(name, "utf8");
    if (filename.length > 65535 || ++entryCount > 65535) throw new UserError("Deployment contains too many files or a filename too long for ZIP.");
    const compressed = directory ? data : deflateRawSync(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); // UTF-8 filenames
    header.writeUInt16LE(directory ? 0 : 8, 8);
    header.writeUInt16LE(33, 12); // 1980-01-01, reproducible archives
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // Unix file modes
    header.copy(central, 6, 4, 30);
    central.writeUInt32LE((((directory ? 0o040000 : 0o100000) | (mode & 0o777)) << 16) >>> 0, 38);
    central.writeUInt32LE(localSize, 42);
    localSize += header.length + filename.length + compressed.length;
    centralSize += central.length + filename.length;
    if (localSize + centralSize + 22 > maxBytes) throw tooLarge(maxBytes);
    localParts.push(header, filename, compressed);
    centralParts.push(central, filename);
  }

  async function walk(relative: string, inherited: IgnoreRule[]): Promise<void> {
    const directory = join(root, relative);
    const gitRules = [...inherited, ...ignoreRules(await readIgnore(join(directory, ".gitignore"), maxBytes) ?? "", relative ? `${relative}/` : "", false)];
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name.includes("\\")) throw new UserError(`Cannot pack a filename containing a backslash: ${name}`);
      if (ignored(name, entry.isDirectory(), gitRules)) continue;
      if (entry.isSymbolicLink()) {
        skippedSymlinks.push(name);
        continue;
      }
      // Docker still sends its build instructions when .dockerignore excludes them.
      const excluded = ignored(name, entry.isDirectory(), dockerRules) &&
        !["Dockerfile", ".dockerignore", "Dockerfile.dockerignore"].includes(name);
      const fullPath = join(root, name);
      if (entry.isDirectory()) {
        if (!excluded) addEntry(`${name}/`, Buffer.alloc(0), (await lstat(fullPath)).mode, true);
        // Docker negations can re-include children of an excluded directory.
        if (!excluded || dockerRules.some((rule) => rule.negate)) await walk(name, gitRules);
      } else if (!excluded && entry.isFile()) {
        const data = await readBounded(fullPath, maxBytes - totalBytes, maxBytes);
        totalBytes += data.length;
        addEntry(name, data, (await lstat(fullPath)).mode);
        files.push(name);
      } else if (!excluded) throw new UserError(`Cannot pack non-regular file: ${name}`);
    }
  }

  await walk("", []);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);
  return {
    archive: Buffer.concat([...localParts, ...centralParts, end]),
    files,
    totalBytes,
    hasDockerfile: files.includes("Dockerfile"),
    skippedSymlinks,
  };
}
