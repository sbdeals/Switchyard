/**
 * Server-only client for the Dokploy API.
 *
 * Auth model (MVP): the dashboard is a backend-for-frontend. It signs into
 * Dokploy with admin credentials (from env) and reuses the returned session
 * cookie for subsequent calls. Credentials and cookie never leave the server.
 * Dokploy also supports an `x-api-key` token, gated behind the member
 * `canAccessToAPI` permission — we can switch to that later without touching
 * callers.
 *
 * Dokploy models a database as a service nested under project -> environment.
 * `project.all` returns the tree but trims nested service objects down to their
 * IDs, so we enrich each database via `<engine>.one`.
 */

const BASE = process.env.DOKPLOY_URL ?? "http://localhost:3000";
const EMAIL = process.env.DOKPLOY_EMAIL ?? "";
const PASSWORD = process.env.DOKPLOY_PASSWORD ?? "";

export const ENGINES = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;
export type Engine = (typeof ENGINES)[number];

/** The id query/body key each engine uses, e.g. postgres -> postgresId. */
const idKey = (engine: Engine) => `${engine}Id` as const;

export type DatabaseStatus = "idle" | "running" | "done" | "error";

export interface DatabaseSummary {
  engine: Engine;
  id: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
}

export interface Database extends DatabaseSummary {
  name: string;
  appName: string;
  status: DatabaseStatus;
  dockerImage: string | null;
  databaseName: string | null;
  databaseUser: string | null;
  databasePassword: string | null;
  externalPort: number | null;
  createdAt: string | null;
  /** Raw env block ("KEY=value\n..."). */
  env: string | null;
  cpuLimit: number | null;
  memoryLimit: number | null;
  command: string | null;
  replicas: number | null;
}

/** A directed connection between two services, inferred from env references. */
export interface ServiceEdge {
  source: string; // database id
  target: string; // database id
}

export interface EnvironmentNode {
  environmentId: string;
  name: string;
}
export interface ProjectNode {
  projectId: string;
  name: string;
  environments: EnvironmentNode[];
}

// --- session handling -------------------------------------------------------

let cookieCache: string | null = null;

async function signIn(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dokploy sign-in failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Dokploy sign-in returned no session cookie");
  // Keep just the cookie name=value pairs (drop attributes like Path/HttpOnly).
  cookieCache = setCookie
    .split(/,(?=[^;]+=[^;]+)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");
  return cookieCache;
}

async function getCookie(): Promise<string> {
  return cookieCache ?? (await signIn());
}

type ReqInit = { method?: "GET" | "POST"; body?: unknown };

async function request<T>(path: string, init: ReqInit = {}): Promise<T> {
  const doFetch = async (cookie: string) =>
    fetch(`${BASE}/api/${path}`, {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: BASE,
        Cookie: cookie,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });

  let res = await doFetch(await getCookie());
  if (res.status === 401) {
    // Session expired — sign in again once and retry.
    cookieCache = null;
    res = await doFetch(await getCookie());
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dokploy ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// --- projects ---------------------------------------------------------------

// The raw project.all tree (only the parts we use).
interface RawEnvironment {
  environmentId: string;
  name: string;
  postgres: { postgresId: string }[];
  mysql: { mysqlId: string }[];
  mariadb: { mariadbId: string }[];
  mongo: { mongoId: string }[];
  redis: { redisId: string }[];
}
interface RawProject {
  projectId: string;
  name: string;
  environments: RawEnvironment[];
}

async function rawTree(): Promise<RawProject[]> {
  return request<RawProject[]>("project.all");
}

export async function listProjects(): Promise<ProjectNode[]> {
  const tree = await rawTree();
  return tree.map((p) => ({
    projectId: p.projectId,
    name: p.name,
    environments: p.environments.map((e) => ({
      environmentId: e.environmentId,
      name: e.name,
    })),
  }));
}

export async function createProject(name: string): Promise<void> {
  await request("project.create", { method: "POST", body: { name } });
}

// --- databases --------------------------------------------------------------

function summariesFromTree(tree: RawProject[]): DatabaseSummary[] {
  const out: DatabaseSummary[] = [];
  for (const p of tree) {
    for (const env of p.environments) {
      const base = {
        projectId: p.projectId,
        projectName: p.name,
        environmentId: env.environmentId,
        environmentName: env.name,
      };
      for (const e of ENGINES) {
        const arr = (env[e] ?? []) as Record<string, string>[];
        for (const item of arr) out.push({ engine: e, id: item[idKey(e)], ...base });
      }
    }
  }
  return out;
}

interface RawDatabaseDetail {
  name?: string;
  appName?: string;
  applicationStatus?: DatabaseStatus;
  dockerImage?: string | null;
  databaseName?: string | null;
  databaseUser?: string | null;
  databasePassword?: string | null;
  externalPort?: number | null;
  createdAt?: string | null;
  env?: string | null;
  cpuLimit?: number | null;
  memoryLimit?: number | null;
  command?: string | null;
  replicas?: number | null;
}

async function getDetail(engine: Engine, id: string): Promise<RawDatabaseDetail> {
  return request<RawDatabaseDetail>(`${engine}.one?${idKey(engine)}=${encodeURIComponent(id)}`);
}

/** List every database across all projects, enriched with detail. */
export async function listDatabases(): Promise<Database[]> {
  const summaries = summariesFromTree(await rawTree());
  const detailed = await Promise.all(
    summaries.map(async (s) => {
      const d = await getDetail(s.engine, s.id);
      return {
        ...s,
        name: d.name ?? s.id,
        appName: d.appName ?? "",
        status: d.applicationStatus ?? "idle",
        dockerImage: d.dockerImage ?? null,
        databaseName: d.databaseName ?? null,
        databaseUser: d.databaseUser ?? null,
        databasePassword: d.databasePassword ?? null,
        externalPort: d.externalPort ?? null,
        createdAt: d.createdAt ?? null,
        env: d.env ?? null,
        cpuLimit: d.cpuLimit ?? null,
        memoryLimit: d.memoryLimit ?? null,
        command: d.command ?? null,
        replicas: d.replicas ?? null,
      } satisfies Database;
    })
  );
  return detailed.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Infer connections between services: if service A's env references service B's
 * appName or name (e.g. a host in a connection string), draw A -> B. Dokploy has
 * no native connection concept, so this is the closest signal available.
 */
export function inferEdges(databases: Database[]): ServiceEdge[] {
  const edges: ServiceEdge[] = [];
  const seen = new Set<string>();
  for (const a of databases) {
    const haystack = (a.env ?? "").toLowerCase();
    if (!haystack) continue;
    for (const b of databases) {
      if (a.id === b.id) continue;
      const needles = [b.appName, b.name].filter(Boolean).map((s) => s.toLowerCase());
      if (needles.some((n) => n.length > 2 && haystack.includes(n))) {
        const key = `${a.id}->${b.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ source: a.id, target: b.id });
        }
      }
    }
  }
  return edges;
}

/** Replace a database's environment variables (raw "KEY=value" block). */
export async function saveEnvironment(engine: Engine, id: string, env: string): Promise<void> {
  await request(`${engine}.saveEnvironment`, {
    method: "POST",
    body: { [idKey(engine)]: id, env },
  });
}

export interface CreateDatabaseInput {
  engine: Engine;
  name: string;
  environmentId: string;
  databaseName?: string;
  databaseUser?: string;
  databasePassword: string;
  dockerImage?: string;
}

/** Create a database record. Field set depends on the engine. */
export async function createDatabase(input: CreateDatabaseInput): Promise<void> {
  const { engine, name, environmentId, databasePassword, dockerImage } = input;
  const body: Record<string, unknown> = { name, environmentId, databasePassword };
  if (dockerImage) body.dockerImage = dockerImage;
  // redis has no databaseName/User; mongo has no databaseName.
  if (engine !== "redis") body.databaseUser = input.databaseUser ?? "admin";
  if (engine !== "redis" && engine !== "mongo")
    body.databaseName = input.databaseName ?? name;
  await request(`${engine}.create`, { method: "POST", body });
}

type Action = "deploy" | "start" | "stop" | "remove";

/** Run a lifecycle action against a database. */
export async function databaseAction(engine: Engine, id: string, action: Action): Promise<void> {
  await request(`${engine}.${action}`, {
    method: "POST",
    body: { [idKey(engine)]: id },
  });
}
