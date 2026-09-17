/**
 * Switchyard-managed compose stacks: one-click databases and image apps that
 * run as plain `docker compose` projects on the local bridge network instead
 * of Swarm services. Used when the host can't run Swarm services (no overlay
 * network — see lib/deploy-target.ts).
 *
 * The stack carries its own identity in an `x-switchyard` extension block
 * (valid compose, ignored by Docker, survives YAML re-serialization), so the
 * dashboard can present it as "Redis" or "Docker image" rather than a raw
 * compose stack. Client-safe: pure string work, no server imports.
 */
import type { Engine } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";

/** Shared bridge network every Dokploy-managed container joins (Traefik lives here). */
export const BRIDGE_NETWORK = "dokploy-network";

export type ManagedMeta =
  | { kind: "database"; engine: Engine; image: string }
  | { kind: "image"; image: string };

const ENGINES = new Set<string>(Object.keys(ENGINE_META));

/** Read the `x-switchyard` block from a compose file, or null for ordinary stacks. */
export function parseManaged(composeFile: string | null | undefined): ManagedMeta | null {
  if (!composeFile) return null;
  const block = composeFile.match(/^x-switchyard:[ \t]*\r?\n((?:[ \t]+\S.*(?:\r?\n|$))+)/m);
  if (!block) return null;
  const fields: Record<string, string> = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^[ \t]+([\w-]+):[ \t]*["']?([^"'\r\n]*?)["']?[ \t]*$/);
    if (m) fields[m[1]] = m[2];
  }
  if (fields.kind === "database" && ENGINES.has(fields.engine) && fields.image) {
    return { kind: "database", engine: fields.engine as Engine, image: fields.image };
  }
  if (fields.kind === "image" && fields.image) return { kind: "image", image: fields.image };
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
          - ${alias}`;
}

const FOOTER = `networks:
  ${BRIDGE_NETWORK}:
    external: true
`;

/** A YAML-safe scalar for image refs and names (quoted only when needed). */
function scalar(s: string): string {
  return /^[\w./:@-]+$/.test(s) ? s : JSON.stringify(s);
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

/**
 * One-click image stacks created before variables were passed through lack
 * `env_file`; add it under the `app` service so Variables reach the container.
 * Returns the file unchanged for anything else (including user-edited stacks
 * where the expected line isn't found).
 */
export function withImageEnvFile(composeFile: string): string {
  if (parseManaged(composeFile)?.kind !== "image" || /^\s+env_file:/m.test(composeFile)) {
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
