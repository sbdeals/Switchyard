/**
 * Switchyard-managed compose stacks: one-click databases, image and repo apps that
 * run as plain `docker compose` projects on the local bridge network instead
 * of Swarm services. Used when the host can't run Swarm services (no overlay
 * network — see lib/deploy-target.ts).
 *
 * The stack carries its own identity in an `x-switchyard` extension block
 * (valid compose, ignored by Docker, survives YAML re-serialization), so the
 * dashboard can present it as "Redis" or "Docker image" rather than a raw
 * compose stack. Client-safe: pure string work, no server imports.
 */
import type { DomainInput, Engine } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";

/** Shared bridge network every Dokploy-managed container joins (Traefik lives here). */
export const BRIDGE_NETWORK = "dokploy-network";

export const MAX_MANAGED_HISTORY = 5;

export interface ManagedDeployEntry {
  timestamp: string;
  image: string;
}

interface ManagedAppHistory {
  history?: ManagedDeployEntry[];
  rollbackUnavailable?: boolean;
}

export type ManagedMeta =
  | { kind: "database"; engine: Engine; image: string }
  | ({ kind: "image"; image: string } & ManagedAppHistory)
  | ({ kind: "repo"; image: string; repoUrl: string; branch: string; subdirectory?: string; dockerfile?: string; pinnedTag?: string } & ManagedAppHistory);

const ENGINES = new Set<string>(Object.keys(ENGINE_META));
const META_BLOCK = /^x-switchyard:[ \t]*\r?\n(?:(?:[ \t]+[^\r\n]*|[ \t]*)(?:\r?\n|$))*/m;

function readScalar(value: string): string | null {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : null;
    } catch { return null; }
  }
  if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  return value.startsWith("'") ? null : value;
}

function validTimestamp(timestamp: unknown): timestamp is string {
  return typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)) &&
    new Date(timestamp).toISOString() === timestamp;
}

function readHistory(value: string): ManagedDeployEntry[] {
  try {
    const entries: unknown = JSON.parse(value);
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry): entry is ManagedDeployEntry => {
      if (!entry || typeof entry !== "object" || !validTimestamp(entry.timestamp)) return false;
      try { validateImageRef(entry.image); return true; } catch { return false; }
    }).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .filter((entry, index, all) => all.findIndex((other) => other.image === entry.image) === index)
      .slice(0, MAX_MANAGED_HISTORY).map(({ timestamp, image }) => ({ timestamp, image }));
  } catch { return []; }
}

/** Read the `x-switchyard` block from a compose file, or null for ordinary stacks. */
export function parseManaged(composeFile: string | null | undefined): ManagedMeta | null {
  if (!composeFile) return null;
  const block = composeFile.match(META_BLOCK);
  if (!block) return null;
  const fields: Record<string, string> = {};
  for (const line of block[0].split("\n")) {
    // Only direct metadata fields count; nested YAML must not override identity.
    const m = line.match(/^  ([\w-]+):[ \t]*(.*?)[ \t\r]*$/);
    if (!m) continue;
    if (Object.hasOwn(fields, m[1])) return null;
    const value = readScalar(m[2]);
    if (value !== null) fields[m[1]] = value;
  }
  if (fields.kind === "database" && ENGINES.has(fields.engine) && fields.image) {
    return { kind: "database", engine: fields.engine as Engine, image: fields.image };
  }
  const history: ManagedAppHistory = {
    ...(fields.history !== undefined ? { history: readHistory(fields.history) } : {}),
    ...(/^(true|false)$/.test(fields.rollbackUnavailable ?? "") ? { rollbackUnavailable: fields.rollbackUnavailable === "true" } : {}),
  };
  if (fields.kind === "image" && fields.image) return { kind: "image", image: fields.image, ...history };
  if (fields.kind === "repo" && fields.image && fields.repoUrl && fields.branch) {
    return {
      kind: "repo", image: fields.image, repoUrl: fields.repoUrl, branch: fields.branch,
      ...(fields.subdirectory ? { subdirectory: fields.subdirectory } : {}),
      ...(fields.dockerfile ? { dockerfile: fields.dockerfile } : {}),
      ...(fields.pinnedTag ? { pinnedTag: fields.pinnedTag } : {}),
      ...history,
    };
  }
  return null;
}

/** Parse a "KEY=value" env block (comments and blanks skipped). */
export function parseEnv(env: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (env ?? "").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Network block joining the shared bridge, reachable by `alias` like a Swarm service name. */
function networkBlock(alias: string): string {
  return `    networks:
      ${BRIDGE_NETWORK}:
        aliases:
          - ${scalar(alias)}`;
}

const FOOTER = `networks:
  ${BRIDGE_NETWORK}:
    external: true
`;

/** A YAML-safe scalar for image refs and names (quoted only when needed). */
function scalar(s: string): string {
  return /^[\w./][\w./:@-]*$/.test(s) && !s.endsWith(":") &&
    !/^(?:null|true|false|yes|no|on|off|\d.*|\.(?:\d.*|inf|nan))$/i.test(s) ? s : JSON.stringify(s);
}

/** Names are used in Docker repository names and Compose project filters. */
export function validateManagedAppName(appName: string): void {
  if (typeof appName !== "string" || /\s/.test(appName) || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(appName)) {
    throw new Error("Invalid managed app name.");
  }
}

/** Docker references only: no URLs, credentials, interpolation, or shell syntax. */
export function validateImageRef(image: string): void {
  if (typeof image !== "string" || image.length > 512 || !image || /[\s$]/.test(image)) {
    throw new Error("Invalid Docker image reference.");
  }
  const [named, digest, ...extra] = image.split("@");
  if (extra.length || (digest !== undefined && !/^(?:sha256:[a-fA-F0-9]{64}|sha384:[a-fA-F0-9]{96}|sha512:[a-fA-F0-9]{128})$/.test(digest))) {
    throw new Error("Invalid Docker image reference.");
  }
  const tagSeparator = named.lastIndexOf(":");
  const hasTag = tagSeparator > named.lastIndexOf("/") && !named.endsWith("]");
  const name = hasTag ? named.slice(0, tagSeparator) : named;
  if (hasTag && !/^[\w][\w.-]{0,127}$/.test(named.slice(tagSeparator + 1))) {
    throw new Error("Invalid Docker image tag.");
  }
  const parts = name.split("/");
  if (parts.length > 1 && (/[.:\[\]]/.test(parts[0]) || parts[0] === "localhost")) {
    const registry = parts.shift()!;
    if (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[a-fA-F0-9:]+\])(?::[0-9]{1,5})?$/.test(registry)) {
      throw new Error("Invalid Docker image registry.");
    }
  }
  if (name.length > 255 || !parts.every((part) => /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/.test(part))) {
    throw new Error("Invalid Docker image reference.");
  }
}

/** Only this app's immutable local snapshots may be pinned or deleted. */
export function validateRepoTag(appName: string, tag: string): void {
  validateManagedAppName(appName);
  validateImageRef(tag);
  const prefix = `${appName}-app:sy-`;
  const timestamp = tag.startsWith(prefix) ? tag.slice(prefix.length) : "";
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp)) || Number(timestamp) > 8640000000000000) {
    throw new Error("Invalid local rollback image tag.");
  }
}

export function repoSnapshotTag(appName: string, timestamp: string): string {
  validateManagedAppName(appName);
  if (!validTimestamp(timestamp)) throw new Error("Invalid deployment timestamp.");
  const tag = `${appName}-app:sy-${Date.parse(timestamp)}`;
  validateRepoTag(appName, tag);
  return tag;
}

/** Retain the newest deployment of each image, without pruning a retained tag. */
export function recordManagedDeploy(history: ManagedDeployEntry[] | undefined, entry: ManagedDeployEntry): {
  history: ManagedDeployEntry[];
  pruned: ManagedDeployEntry[];
} {
  const all = [entry, ...(history ?? [])];
  for (const deploy of all) {
    if (!validTimestamp(deploy.timestamp)) throw new Error("Invalid deployment timestamp.");
    validateImageRef(deploy.image);
  }
  const retained = [...all].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .filter((deploy, index, sorted) => sorted.findIndex((other) => other.image === deploy.image) === index)
    .slice(0, MAX_MANAGED_HISTORY);
  const pruned = all.filter((deploy, index) => !retained.some((other) => other.image === deploy.image) &&
    all.findIndex((other) => other.image === deploy.image) === index);
  return { history: retained, pruned };
}

/** Update the extension block only; Dokploy owns domains and service labels. */
export function writeManagedMeta(composeFile: string, meta: ManagedMeta): string {
  if ((composeFile.match(/^x-switchyard:/gm) ?? []).length !== 1 || !META_BLOCK.test(composeFile)) {
    throw new Error("Managed compose metadata is missing or ambiguous.");
  }
  validateImageRef(meta.image);
  const lines = ["x-switchyard:", `  kind: ${meta.kind}`];
  if (meta.kind === "database") lines.push(`  engine: ${meta.engine}`);
  lines.push(`  image: ${scalar(meta.image)}`);
  if (meta.kind === "repo") {
    validateRepoSource(meta);
    lines.push(`  repoUrl: ${scalar(meta.repoUrl)}`, `  branch: ${scalar(meta.branch)}`);
    if (meta.subdirectory) lines.push(`  subdirectory: ${scalar(meta.subdirectory)}`);
    if (meta.dockerfile) lines.push(`  dockerfile: ${scalar(meta.dockerfile)}`);
    if (meta.pinnedTag) {
      validateImageRef(meta.pinnedTag);
      lines.push(`  pinnedTag: ${scalar(meta.pinnedTag)}`);
    }
  }
  if (meta.kind !== "database") {
    if (meta.history !== undefined) {
      // Validate before writing, rather than silently storing an unusable entry.
      for (const entry of meta.history) {
        if (!validTimestamp(entry.timestamp)) throw new Error("Invalid deployment timestamp.");
        validateImageRef(entry.image);
      }
      if (meta.history.length > MAX_MANAGED_HISTORY) throw new Error("Too many previous deploys.");
      lines.push(`  history: ${JSON.stringify(meta.history)}`);
    }
    if (meta.rollbackUnavailable !== undefined) lines.push(`  rollbackUnavailable: ${meta.rollbackUnavailable}`);
  }
  const newline = composeFile.includes("\r\n") ? "\r\n" : "\n";
  return composeFile.replace(META_BLOCK, `${lines.join(newline)}${newline}`);
}

export interface RepoStackInput {
  appName: string;
  repoUrl: string;
  branch: string;
  subdirectory?: string;
  dockerfile?: string;
}

/** Validate a public Git source before creating a bridge stack. */
export function validateRepoSource(input: Omit<RepoStackInput, "appName">): void {
  if ([input.repoUrl, input.branch, input.subdirectory, input.dockerfile].some((value) => value?.includes("$"))) {
    throw new Error("Repository URL, branch, subdirectory, and Dockerfile path must not contain $ (Compose interpolation is unsupported).");
  }
  let url: URL;
  try {
    url = new URL(input.repoUrl);
  } catch {
    throw new Error("Repository URL must be a valid public http:// or https:// URL.");
  }
  if (!/^https?:\/\//i.test(input.repoUrl) || /\s/.test(input.repoUrl) || !url.hostname) {
    throw new Error("Repository URL must use http:// or https:// and contain no whitespace.");
  }
  if (url.username || url.password || /^https?:\/\/[^/?#]*@/i.test(input.repoUrl)) {
    throw new Error("Repository URL must not contain credentials. Use a public repository URL.");
  }
  if (input.repoUrl.includes("#")) {
    throw new Error("Repository URL must not contain #. Set the branch separately.");
  }
  if (!input.branch || /[\s#:]/.test(input.branch)) {
    throw new Error("Branch must be nonempty and contain no whitespace, #, or :.");
  }
  if (input.subdirectory && (input.subdirectory.includes("..") || /[#:]/.test(input.subdirectory))) {
    throw new Error("Repository subdirectory must not contain .., #, or :.");
  }
}

export interface DatabaseStackInput {
  engine: Engine;
  /** Dokploy appName of the compose stack — the internal hostname. */
  appName: string;
  /** Tag from ENGINE_META versions, e.g. "7". */
  version: string;
  password: string;
  /** Database name (engines that take one). */
  databaseName: string;
  /** Login user (engines that take one). */
  databaseUser: string;
}

/** Engine-specific container config: env keys, data dir, command, healthcheck. */
function engineSpec(input: DatabaseStackInput): {
  env: Record<string, string>;
  environment: string[];
  dataDir: string;
  command?: string;
  healthcheck?: string;
} {
  const { engine, version, password, databaseName, databaseUser } = input;
  switch (engine) {
    case "postgres":
      return {
        env: { POSTGRES_USER: databaseUser, POSTGRES_PASSWORD: password, POSTGRES_DB: databaseName },
        environment: ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"],
        // postgres:18+ keeps data under a versioned dir and refuses a mount at .../data.
        dataDir: Number(version) >= 18 ? "/var/lib/postgresql" : "/var/lib/postgresql/data",
        healthcheck: `["CMD-SHELL", "pg_isready -U \\"$$POSTGRES_USER\\" -d \\"$$POSTGRES_DB\\""]`,
      };
    case "mysql":
      return {
        env: {
          MYSQL_ROOT_PASSWORD: password,
          MYSQL_USER: databaseUser,
          MYSQL_PASSWORD: password,
          MYSQL_DATABASE: databaseName,
        },
        environment: ["MYSQL_ROOT_PASSWORD", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"],
        dataDir: "/var/lib/mysql",
      };
    case "mariadb":
      return {
        env: {
          MARIADB_ROOT_PASSWORD: password,
          MARIADB_USER: databaseUser,
          MARIADB_PASSWORD: password,
          MARIADB_DATABASE: databaseName,
        },
        environment: ["MARIADB_ROOT_PASSWORD", "MARIADB_USER", "MARIADB_PASSWORD", "MARIADB_DATABASE"],
        dataDir: "/var/lib/mysql",
      };
    case "mongo":
      return {
        env: { MONGO_INITDB_ROOT_USERNAME: databaseUser, MONGO_INITDB_ROOT_PASSWORD: password },
        environment: ["MONGO_INITDB_ROOT_USERNAME", "MONGO_INITDB_ROOT_PASSWORD"],
        dataDir: "/data/db",
      };
    case "redis":
      return {
        env: { REDIS_PASSWORD: password },
        environment: ["REDIS_PASSWORD"],
        dataDir: "/data",
        command: `["redis-server", "--requirepass", "\${REDIS_PASSWORD}", "--appendonly", "yes"]`,
        healthcheck: `["CMD-SHELL", "redis-cli -a \\"$$REDIS_PASSWORD\\" --no-auth-warning ping | grep -q PONG"]`,
      };
  }
}

/** Compose file + env for a one-click database on the bridge network. */
export function databaseStack(input: DatabaseStackInput): { composeFile: string; env: string } {
  const meta = ENGINE_META[input.engine];
  const image = `${meta.image}:${input.version}`;
  const spec = engineSpec(input);
  const lines = [
    `x-switchyard:`,
    `  kind: database`,
    `  engine: ${input.engine}`,
    `  image: ${scalar(image)}`,
    `services:`,
    `  ${input.engine}:`,
    `    image: ${scalar(image)}`,
    `    restart: unless-stopped`,
  ];
  if (spec.command) lines.push(`    command: ${spec.command}`);
  lines.push(`    environment:`);
  for (const key of spec.environment) lines.push(`      ${key}: \${${key}}`);
  lines.push(`    volumes:`, `      - data:${spec.dataDir}`);
  if (spec.healthcheck) {
    lines.push(
      `    healthcheck:`,
      `      test: ${spec.healthcheck}`,
      `      interval: 10s`,
      `      timeout: 5s`,
      `      retries: 5`
    );
  }
  lines.push(networkBlock(input.appName), `volumes:`, `  data:`, FOOTER);
  const env = Object.entries(spec.env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  return { composeFile: lines.join("\n"), env };
}

/** Compose file for a one-click Docker image app on the bridge network. */
export function imageStack(input: { appName: string; image: string }): string {
  validateManagedAppName(input.appName);
  validateImageRef(input.image);
  const image = scalar(input.image);
  return [
    `x-switchyard:`,
    `  kind: image`,
    `  image: ${image}`,
    `services:`,
    `  app:`,
    `    image: ${image}`,
    `    restart: unless-stopped`,
    // The service's Variables (written by the engine next to this file).
    `    env_file:`,
    `      - .env`,
    networkBlock(input.appName),
    FOOTER,
  ].join("\n");
}

/** Build a public Dockerfile repository as a local image on the bridge network. */
export function repoStack(input: RepoStackInput): string {
  validateManagedAppName(input.appName);
  validateRepoSource(input);
  const image = scalar(`${input.appName}-app:latest`);
  const lines = [
    `x-switchyard:`,
    `  kind: repo`,
    `  image: ${image}`,
    `  repoUrl: ${scalar(input.repoUrl)}`,
    `  branch: ${scalar(input.branch)}`,
  ];
  if (input.subdirectory) lines.push(`  subdirectory: ${scalar(input.subdirectory)}`);
  if (input.dockerfile) lines.push(`  dockerfile: ${scalar(input.dockerfile)}`);
  lines.push(
    `services:`,
    `  app:`,
    ...repoBuildLines(input),
    `    image: ${image}`,
    `    restart: unless-stopped`,
    `    env_file:`,
    `      - .env`,
    networkBlock(input.appName),
    FOOTER,
  );
  return lines.join("\n");
}

function repoBuildLines(input: Omit<RepoStackInput, "appName">): string[] {
  validateRepoSource(input);
  // BuildKit needs the .git suffix to distinguish a Git context from an HTTP file.
  const repoUrl = new URL(input.repoUrl);
  const path = repoUrl.pathname.replace(/\/+$/, "");
  repoUrl.pathname = path.endsWith(".git") ? path : `${path}.git`;
  const context = `${repoUrl.href}#${input.branch}${input.subdirectory ? `:${input.subdirectory}` : ""}`;
  const lines = ["    build:", `      context: ${scalar(context)}`];
  if (input.dockerfile && input.dockerfile !== "Dockerfile") lines.push(`      dockerfile: ${scalar(input.dockerfile)}`);
  return lines;
}

/** Restrict string rewrites to the unambiguous block shape we generate. */
function managedAppBlock(composeFile: string): { lines: string[]; start: number; end: number; image: number } {
  const lines = composeFile.split(/\r?\n/);
  if (lines.some((line) => /^(?:"services"|'services'):/.test(line))) throw new Error("Managed app services must use a plain YAML block.");
  const services = lines.flatMap((line, index) => /^services[ \t]*:/.test(line) ? [index] : []);
  if (services.length !== 1 || lines[services[0]] !== "services:") throw new Error("Managed app services must use a plain YAML block.");
  let servicesEnd = services[0] + 1;
  while (servicesEnd < lines.length && (!lines[servicesEnd].trim() || /^\s|^#/.test(lines[servicesEnd]))) servicesEnd++;
  const apps = lines.flatMap((line, index) => index > services[0] && index < servicesEnd && /^  app:/.test(line) ? [index] : []);
  if (apps.length !== 1 || lines[apps[0]] !== "  app:") throw new Error("Managed app service is missing or ambiguous.");
  const start = apps[0] + 1;
  let end = start;
  while (end < servicesEnd && (!lines[end].trim() || /^ {4}|^\s*#/.test(lines[end]))) end++;
  const keys = new Set<string>();
  let image = -1;
  for (let i = services[0] + 1; i < servicesEnd; i++) {
    if (/^ *\t/.test(lines[i])) throw new Error("Managed app services must use spaces for indentation.");
    if (/^ {2}\S/.test(lines[i]) && !/^ {2}(?:[a-zA-Z0-9][a-zA-Z0-9_.-]*:|#)/.test(lines[i])) {
      throw new Error("Managed app services must use plain YAML keys.");
    }
  }
  for (let i = start; i < end; i++) {
    const key = lines[i].match(/^ {4}([^\s:]+):/);
    if (/^ {4}\S/.test(lines[i]) && !/^ {4}(?:[a-zA-Z0-9_-]+:|#)/.test(lines[i])) {
      throw new Error("Managed app fields must use plain YAML keys.");
    }
    if (!key) continue;
    if (key[1] === "<<" || key[1] === "extends" || keys.has(key[1])) throw new Error("Managed app fields are ambiguous.");
    if (/^    (?:build|pull_policy):\s*[&*!]/.test(lines[i])) throw new Error("Managed app build fields cannot use YAML aliases or tags.");
    keys.add(key[1]);
    if (key[1] === "image") image = i;
  }
  if (image < 0) throw new Error("Managed app image is missing.");
  return { lines, start, end, image };
}

/** Read the service image, since the compose editor may have changed it. */
export function managedAppImage(composeFile: string): string {
  const block = managedAppBlock(composeFile);
  const value = readScalar(block.lines[block.image].slice("    image:".length).trim());
  if (value === null) throw new Error("Managed app image must be a plain image reference.");
  validateImageRef(value);
  return value;
}

/** Pin a previous image or reconstruct a repo's normal branch-head build. */
export function rewriteManagedApp(composeFile: string, appName: string, meta: Exclude<ManagedMeta, { kind: "database" }>): string {
  validateManagedAppName(appName);
  managedAppImage(composeFile);
  const block = managedAppBlock(composeFile);
  const image = meta.kind === "repo" ? meta.pinnedTag ?? `${appName}-app:latest` : meta.image;
  validateImageRef(image);
  if (meta.kind === "repo") {
    validateRepoSource(meta);
    if (meta.pinnedTag) validateRepoTag(appName, meta.pinnedTag);
    for (const entry of meta.history ?? []) validateRepoTag(appName, entry.image);
  }
  const replacement: string[] = [];
  for (let i = block.start; i < block.end; i++) {
    if (/^    (?:build|pull_policy):/.test(block.lines[i])) {
      // Remove the entire old field, including a nested build map.
      while (i + 1 < block.end && (/^ {5}|^\s*#/.test(block.lines[i + 1]) || !block.lines[i + 1].trim())) i++;
    } else if (i === block.image) {
      if (meta.kind === "repo" && !meta.pinnedTag) replacement.push(...repoBuildLines(meta));
      replacement.push(`    image: ${scalar(image)}`);
      if (meta.kind === "repo" && meta.pinnedTag) replacement.push("    pull_policy: never");
    } else {
      replacement.push(block.lines[i]);
    }
  }
  block.lines.splice(block.start, block.end - block.start, ...replacement);
  const newline = composeFile.includes("\r\n") ? "\r\n" : "\n";
  return writeManagedMeta(block.lines.join(newline), { ...meta, image });
}

/**
 * Native compose domains inject Traefik labels even with isolatedDeployment:false,
 * preserving our shared network alias. Keeping the domain in Dokploy also keeps
 * Networking CRUD and the dashboard's domain list in sync.
 */
export function bridgeImageDomain(input: {
  appName: string;
  hostIp: string;
  generatedHost: string | null;
  port: number;
}): DomainInput {
  return {
    host: input.generatedHost ?? `${input.appName}.${input.hostIp}.sslip.io`,
    port: input.port,
    https: input.generatedHost === null,
    certificateType: input.generatedHost === null ? "letsencrypt" : "none",
    path: "/",
  };
}

/**
 * Managed app stacks created before variables were passed through lack
 * `env_file`; add it under the `app` service so Variables reach the container.
 * Returns the file unchanged for anything else (including user-edited stacks
 * where the expected line isn't found).
 */
export function withImageEnvFile(composeFile: string): string {
  const kind = parseManaged(composeFile)?.kind;
  if ((kind !== "image" && kind !== "repo") || /^\s+env_file:/m.test(composeFile)) {
    return composeFile;
  }
  return composeFile.replace(
    /^(  app:\r?\n(?:    .*\r?\n)*?    restart: [^\r\n]*\r?\n)/m,
    "$1    env_file:\n      - .env\n"
  );
}

/**
 * Internal connection string for a managed database stack: other containers on
 * the bridge reach it at `appName:defaultPort` (the network alias), mirroring
 * Swarm-backed databases. Credentials come from the stack's env.
 */
export function managedConnectionString(
  engine: Engine,
  appName: string,
  envBlock: string | null
): string | null {
  const env = parseEnv(envBlock);
  const port = ENGINE_META[engine].defaultPort;
  const host = appName;
  switch (engine) {
    case "postgres":
      return `postgresql://${env.POSTGRES_USER ?? ""}:${env.POSTGRES_PASSWORD ?? ""}@${host}:${port}/${env.POSTGRES_DB ?? ""}`;
    case "mysql":
      return `mysql://${env.MYSQL_USER ?? ""}:${env.MYSQL_PASSWORD ?? ""}@${host}:${port}/${env.MYSQL_DATABASE ?? ""}`;
    case "mariadb":
      return `mysql://${env.MARIADB_USER ?? ""}:${env.MARIADB_PASSWORD ?? ""}@${host}:${port}/${env.MARIADB_DATABASE ?? ""}`;
    case "mongo":
      return `mongodb://${env.MONGO_INITDB_ROOT_USERNAME ?? ""}:${env.MONGO_INITDB_ROOT_PASSWORD ?? ""}@${host}:${port}`;
    case "redis":
      return `redis://default:${env.REDIS_PASSWORD ?? ""}@${host}:${port}`;
  }
}
