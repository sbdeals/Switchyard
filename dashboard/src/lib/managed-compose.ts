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
import type { BuildKind, BuildPlan } from "@/lib/build-plan";

/** Shared bridge network every Dokploy-managed container joins (Traefik lives here). */
export const BRIDGE_NETWORK = "dokploy-network";

export interface ManagedAutoDomain {
  host: string;
  port: number;
}

export type ManagedMeta =
  | { kind: "database"; engine: Engine; image: string }
  | { kind: "image"; image: string; autoDomain?: ManagedAutoDomain }
  | { kind: "repo"; image: string; repoUrl: string; branch: string; subdirectory?: string; dockerfile?: string; buildKind?: BuildKind; buildPort?: number; autoDomain?: ManagedAutoDomain };

const ENGINES = new Set<string>(Object.keys(ENGINE_META));
const MANAGED_BLOCK = /^x-switchyard:[ \t]*\r?\n((?:[ \t]+\S.*(?:\r?\n|$))+)/m;

function validManagedAutoDomain(domain: ManagedAutoDomain): boolean {
  return typeof domain.host === "string" && /^[A-Za-z0-9.-]+$/.test(domain.host) &&
    Number.isInteger(domain.port) && domain.port >= 1 && domain.port <= 65535;
}

/** Read the `x-switchyard` block from a compose file, or null for ordinary stacks. */
export function parseManaged(composeFile: string | null | undefined): ManagedMeta | null {
  if (!composeFile) return null;
  const block = composeFile.match(MANAGED_BLOCK);
  if (!block) return null;
  const indent = block[1].match(/^[ \t]+/)![0];
  const fields: Record<string, string> = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^[ \t]+([\w-]+):[ \t]*(.*?)[ \t\r]*$/);
    if (!m) continue;
    if (["autoDomainHost", "autoDomainPort", "buildKind", "buildPort"].includes(m[1]) && !line.startsWith(`${indent}${m[1]}:`)) continue;
    const value = m[2];
    if (value.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === "string") fields[m[1]] = parsed;
      } catch { /* Ignore malformed quoted metadata. */ }
    } else if (/^'(?:[^']|'')*'$/.test(value)) {
      fields[m[1]] = value.slice(1, -1).replace(/''/g, "'");
    } else if (!value.startsWith("'")) {
      fields[m[1]] = value;
    }
  }
  if (fields.kind === "database" && ENGINES.has(fields.engine) && fields.image) {
    return { kind: "database", engine: fields.engine as Engine, image: fields.image };
  }
  const marker = { host: fields.autoDomainHost, port: Number(fields.autoDomainPort) };
  const autoDomain = /^\d+$/.test(fields.autoDomainPort ?? "") && validManagedAutoDomain(marker)
    ? { autoDomain: marker } : {};
  if (fields.kind === "image" && fields.image) return { kind: "image", image: fields.image, ...autoDomain };
  if (fields.kind === "repo" && fields.image && fields.repoUrl && fields.branch) {
    const build = ["node", "python", "go", "static"].includes(fields.buildKind) &&
      /^\d+$/.test(fields.buildPort ?? "") && Number(fields.buildPort) >= 1 && Number(fields.buildPort) <= 65535
      ? { buildKind: fields.buildKind as BuildKind, buildPort: Number(fields.buildPort) } : {};
    return {
      kind: "repo", image: fields.image, repoUrl: fields.repoUrl, branch: fields.branch,
      ...(fields.subdirectory ? { subdirectory: fields.subdirectory } : {}),
      ...(fields.dockerfile ? { dockerfile: fields.dockerfile } : {}),
      ...build,
      ...autoDomain,
    };
  }
  return null;
}

/** Record the last automatic routing choice; clearing it preserves explicit Networking edits. */
export function withManagedAutoDomain(composeFile: string, domain: ManagedAutoDomain | null): string {
  const kind = parseManaged(composeFile)?.kind;
  if (kind !== "image" && kind !== "repo") return composeFile;
  if (domain && !validManagedAutoDomain(domain)) throw new Error("Invalid automatic domain metadata.");
  return composeFile.replace(MANAGED_BLOCK, (block: string, fields: string) => {
    const indent = fields.match(/^[ \t]+/)![0];
    const newline = block.includes("\r\n") ? "\r\n" : "\n";
    const markerFields = new RegExp(`^${indent}(?:autoDomainHost|autoDomainPort):[^\\r\\n]*(?:\\r?\\n|$)`, "gm");
    const updated = block.replace(markerFields, "");
    if (!domain) return updated;
    const headerEnd = updated.indexOf("\n") + 1;
    return updated.slice(0, headerEnd) +
      `${indent}autoDomainHost: ${JSON.stringify(domain.host)}${newline}` +
      `${indent}autoDomainPort: ${domain.port}${newline}` + updated.slice(headerEnd);
  });
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

/** Build a public repository as a local image on the bridge network. */
export function repoStack(input: RepoStackInput, plan?: BuildPlan): string {
  validateRepoSource(input);
  const image = scalar(`${input.appName}-app:latest`);
  // BuildKit needs the .git suffix to distinguish a Git context from an HTTP file.
  const repoUrl = new URL(input.repoUrl);
  const path = repoUrl.pathname.replace(/\/+$/, "");
  repoUrl.pathname = path.endsWith(".git") ? path : `${path}.git`;
  const context = `${repoUrl.href}#${input.branch}${input.subdirectory ? `:${input.subdirectory}` : ""}`;
  const lines = [
    `x-switchyard:`,
    `  kind: repo`,
    `  image: ${image}`,
    `  repoUrl: ${scalar(input.repoUrl)}`,
    `  branch: ${scalar(input.branch)}`,
  ];
  if (input.subdirectory) lines.push(`  subdirectory: ${scalar(input.subdirectory)}`);
  if (input.dockerfile) lines.push(`  dockerfile: ${scalar(input.dockerfile)}`);
  const generated = plan && plan.kind !== "dockerfile" && plan.dockerfileInline;
  if (generated) lines.push(`  buildKind: ${plan.kind}`, `  buildPort: ${plan.port}`);
  lines.push(
    `services:`,
    `  app:`,
    `    build:`,
    `      context: ${scalar(context)}`,
  );
  if (generated) {
    lines.push(`      dockerfile_inline: |`,
      // Preserve container/build-time variables through Compose interpolation.
      ...generated.trimEnd().split("\n").map((line) => `        ${line.replaceAll("$", "$$$$")}`));
  } else if (input.dockerfile && input.dockerfile !== "Dockerfile") {
    lines.push(`      dockerfile: ${scalar(input.dockerfile)}`);
  }
  lines.push(
    `    image: ${image}`,
    `    restart: unless-stopped`,
    `    env_file:`,
    `      - .env`,
    networkBlock(input.appName),
    FOOTER,
  );
  return lines.join("\n");
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
