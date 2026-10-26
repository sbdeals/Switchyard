/**
 * Built-in variables a service exposes to `${{ServiceName.VAR}}` references
 * (see lib/references.ts), plus the glue that turns the workspace's services
 * into resolver targets. The server resolves values before saving/deploying;
 * the Variables picker receives only the available variable names.
 *
 * Every service:
 *   SWITCHYARD_HOST          internal hostname other services reach it at
 *                            (network alias on the bridge / Swarm service name)
 *   SWITCHYARD_SERVICE_NAME  its display name
 * Databases (bridge-managed or engine-managed) add:
 *   DATABASE_URL, <ENGINE>_URL (REDIS_URL, POSTGRES_URL, MYSQL_URL, MONGO_URL…)
 *   <ENGINE>_HOST, <ENGINE>_PORT, <ENGINE>_PASSWORD, and where the engine has
 *   them <ENGINE>_USER / <ENGINE>_DATABASE — plus the libpq PG* set for Postgres.
 * A service's own variables take precedence over these names.
 */
import "server-only";
import type { Engine, Service } from "@/lib/dokploy";
import { connectionString } from "@/lib/connection";
import { ENGINE_META } from "@/lib/engines";
import { managedConnectionString, parseEnv } from "@/lib/managed-compose";
import { decodeStoredEnv, type RefTarget } from "@/lib/references";

/** Prefix for per-engine variable names. */
const ENGINE_PREFIX: Record<Engine, string> = {
  postgres: "POSTGRES",
  mysql: "MYSQL",
  mariadb: "MARIADB",
  mongo: "MONGO",
  redis: "REDIS",
};

interface DbParts {
  engine: Engine;
  url: string | null;
  host: string;
  user: string | null;
  password: string | null;
  database: string | null;
}

/** Credentials/host of a database-like service, whichever path runs it. */
function databaseParts(s: Service): DbParts | null {
  if (s.kind === "database") {
    return {
      engine: s.engine,
      url: connectionString(s),
      host: s.appName,
      user: s.engine === "redis" ? "default" : (s.databaseUser ?? null),
      password: s.databasePassword ?? null,
      database: s.databaseName ?? null,
    };
  }
  if (s.kind === "compose" && s.managed?.kind === "database") {
    const engine = s.managed.engine;
    const env = parseEnv(s.env);
    const byEngine: Record<Engine, [string | null, string | null, string | null]> = {
      postgres: [env.POSTGRES_USER, env.POSTGRES_PASSWORD, env.POSTGRES_DB],
      mysql: [env.MYSQL_USER, env.MYSQL_PASSWORD, env.MYSQL_DATABASE],
      mariadb: [env.MARIADB_USER, env.MARIADB_PASSWORD, env.MARIADB_DATABASE],
      mongo: [env.MONGO_INITDB_ROOT_USERNAME, env.MONGO_INITDB_ROOT_PASSWORD, null],
      redis: ["default", env.REDIS_PASSWORD, null],
    };
    const [user, password, database] = byEngine[engine];
    return {
      engine,
      url: managedConnectionString(engine, s.appName, s.env),
      host: s.appName,
      user: user ?? null,
      password: password ?? null,
      database: database ?? null,
    };
  }
  return null;
}

/** The built-in variables for one service (values included — server only). */
export function builtinVars(s: Service): Record<string, string> {
  const vars: Record<string, string> = {};
  if (s.appName) vars.SWITCHYARD_HOST = s.appName;
  vars.SWITCHYARD_SERVICE_NAME = s.name;
  const db = databaseParts(s);
  if (!db) return vars;
  const P = ENGINE_PREFIX[db.engine];
  const port = String(ENGINE_META[db.engine].defaultPort);
  if (db.url) {
    vars.DATABASE_URL = db.url;
    vars[`${P}_URL`] = db.url;
  }
  vars[`${P}_HOST`] = db.host;
  vars[`${P}_PORT`] = port;
  if (db.password) vars[`${P}_PASSWORD`] = db.password;
  if (db.user) vars[`${P}_USER`] = db.user;
  if (db.database) vars[`${P}_DATABASE`] = db.database;
  if (db.engine === "postgres") {
    vars.PGHOST = db.host;
    vars.PGPORT = port;
    if (db.user) vars.PGUSER = db.user;
    if (db.password) vars.PGPASSWORD = db.password;
    if (db.database) vars.PGDATABASE = db.database;
  }
  return vars;
}

/**
 * Resolver targets for every service in the workspace. Names are unique per
 * environment, not globally, so services in `preferEnvironmentId` come first —
 * a name that exists in several environments resolves to the local one.
 */
export function referenceTargets(
  services: readonly Service[],
  preferEnvironmentId?: string
): RefTarget[] {
  const ordered = preferEnvironmentId
    ? [...services].sort(
        (a, b) =>
          Number(b.environmentId === preferEnvironmentId) -
          Number(a.environmentId === preferEnvironmentId)
      )
    : services;
  return ordered.map((s) => ({
    name: s.name,
    template: decodeStoredEnv(s.env),
    builtins: builtinVars(s),
  }));
}

/** Compute non-secret picker metadata before the service's values are redacted. */
export function computeReferenceKeys(s: Service): { own: string[]; builtin: string[] } {
  const own = Object.keys(parseEnv(decodeStoredEnv(s.env)));
  const builtin = Object.keys(builtinVars(s)).filter((k) => !own.includes(k));
  return { own, builtin };
}
