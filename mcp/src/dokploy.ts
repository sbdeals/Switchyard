/**
 * Self-contained client for the Dokploy API.
 *
 * This MCP server is a separate process from the Next.js dashboard, so it can't
 * import `dashboard/src/lib/dokploy.ts`. Instead it mirrors that module's call
 * patterns (deliberate, minimal duplication): sign in with admin creds, cache
 * the session cookie, send `Origin` for better-auth's CSRF check, and retry
 * once on a 401. Behavior therefore matches what the dashboard does.
 *
 * Credentials come from env — the same names the dashboard uses:
 *   DOKPLOY_URL, DOKPLOY_ORIGIN (optional), DOKPLOY_EMAIL, DOKPLOY_PASSWORD.
 */

const BASE = process.env.DOKPLOY_URL ?? "http://localhost:3000";
// Origin header for better-auth's CSRF check. Dokploy only trusts its
// host-facing origins; when reaching it over container service DNS the two
// diverge. Defaults to BASE, which preserves dev-mode behavior.
// `||` (not `??`) so an empty DOKPLOY_ORIGIN — which .mcp.json passes when the
// operator hasn't set one — falls back to BASE instead of an empty Origin header.
const ORIGIN = process.env.DOKPLOY_ORIGIN || BASE;
const EMAIL = process.env.DOKPLOY_EMAIL ?? "";
const PASSWORD = process.env.DOKPLOY_PASSWORD ?? "";

export const ENGINES = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;
export type Engine = (typeof ENGINES)[number];

/** The id query/body key each engine uses, e.g. postgres -> postgresId. */
const idKey = (engine: Engine) => `${engine}Id` as const;

/** Lifecycle actions shared by every service kind. */
export const ACTIONS = ["deploy", "start", "stop", "remove"] as const;
export type Action = (typeof ACTIONS)[number];

export type ServiceKind = "database" | "application" | "compose";

/** Compact view of a deployable service — enough for MCP callers to act on. */
export interface ServiceSummary {
  kind: ServiceKind;
  id: string;
  name: string;
  appName: string;
  status: string;
  /** Present only for databases. */
  engine?: Engine;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  /** Raw env block ("KEY=value\n..."), used by manage_env. */
  env: string | null;
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

function assertConfigured(): void {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Dokploy credentials are not set. Provide DOKPLOY_EMAIL and DOKPLOY_PASSWORD " +
        "(and DOKPLOY_URL if not http://localhost:3000) in the MCP server env."
    );
  }
}

async function signIn(): Promise<string> {
  assertConfigured();
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dokploy sign-in failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Dokploy sign-in returned no session cookie");
  cookieCache = setCookie
    .split(/,(?=[^;]+=[^;]+)/)
    .map((c) => c.split(";")[0]!.trim())
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
        Origin: ORIGIN,
        Cookie: cookie,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  let res = await doFetch(await getCookie());
  if (res.status === 401) {
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

/** Cheapest end-to-end probe: sign in (if needed) and list projects. */
export async function ping(): Promise<void> {
  await request("project.all");
}

// --- project tree -----------------------------------------------------------

interface RawEnvironment {
  environmentId: string;
  name: string;
  postgres?: { postgresId: string }[];
  mysql?: { mysqlId: string }[];
  mariadb?: { mariadbId: string }[];
  mongo?: { mongoId: string }[];
  redis?: { redisId: string }[];
  applications?: { applicationId: string }[];
  compose?: { composeId: string }[];
}
interface RawProject {
  projectId: string;
  name: string;
  environments: RawEnvironment[];
}

async function rawTree(): Promise<RawProject[]> {
  return request<RawProject[]>("project.all");
}

type Scope = Pick<
  ServiceSummary,
  "projectId" | "projectName" | "environmentId" | "environmentName"
>;

function collectIds(
  tree: RawProject[],
  ids: (env: RawEnvironment) => string[]
): ({ id: string } & Scope)[] {
  const out: ({ id: string } & Scope)[] = [];
  for (const p of tree) {
    for (const env of p.environments) {
      for (const id of ids(env)) {
        out.push({
          id,
          projectId: p.projectId,
          projectName: p.name,
          environmentId: env.environmentId,
          environmentName: env.name,
        });
      }
    }
  }
  return out;
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

export async function createProject(name: string): Promise<string> {
  const created = await request<{ projectId: string }>("project.create", {
    method: "POST",
    body: { name },
  });
  return created.projectId;
}

/** Resolve a target environment, creating a default project if none exist. */
export async function resolveTargetEnv(environmentId?: string): Promise<string> {
  if (environmentId) return environmentId;
  const first = (await listProjects()).flatMap((p) => p.environments)[0];
  if (first) return first.environmentId;
  await createProject("My Project");
  const after = (await listProjects()).flatMap((p) => p.environments)[0];
  if (!after) throw new Error("Could not create a default environment.");
  return after.environmentId;
}

// --- detail shapes ----------------------------------------------------------

interface RawDetail {
  name?: string;
  appName?: string;
  applicationStatus?: string;
  composeStatus?: string;
  env?: string | null;
}

async function dbDetail(engine: Engine, id: string): Promise<RawDetail> {
  return request<RawDetail>(`${engine}.one?${idKey(engine)}=${encodeURIComponent(id)}`);
}
async function appDetail(id: string): Promise<RawDetail> {
  return request<RawDetail>(`application.one?applicationId=${encodeURIComponent(id)}`);
}
async function composeDetail(id: string): Promise<RawDetail> {
  return request<RawDetail>(`compose.one?composeId=${encodeURIComponent(id)}`);
}

/** appName + name for a freshly created service, so callers can wire up logs. */
export interface ServiceRef {
  id: string;
  kind: ServiceKind;
  name: string;
  appName: string;
  engine?: Engine;
}

// --- unified service listing ------------------------------------------------

/**
 * Enumerate every service across the workspace, enriched with per-service
 * detail (an N+1 fan-out, same as the dashboard's loadWorkspace).
 */
export async function listServices(): Promise<ServiceSummary[]> {
  const tree = await rawTree();

  const dbRefs = ENGINES.flatMap((engine) =>
    collectIds(tree, (env) =>
      (env[engine] ?? []).map((item) => (item as Record<string, string>)[idKey(engine)]!)
    ).map((ref) => ({ ...ref, engine }))
  );
  const appRefs = collectIds(tree, (env) => (env.applications ?? []).map((a) => a.applicationId));
  const composeRefs = collectIds(tree, (env) => (env.compose ?? []).map((c) => c.composeId));

  const [databases, applications, compose] = await Promise.all([
    Promise.all(
      dbRefs.map(async ({ engine, ...ref }) => {
        const d = await dbDetail(engine, ref.id);
        return {
          kind: "database" as const,
          ...ref,
          engine,
          name: d.name ?? ref.id,
          appName: d.appName ?? "",
          status: d.applicationStatus ?? "idle",
          env: d.env ?? null,
        } satisfies ServiceSummary;
      })
    ),
    Promise.all(
      appRefs.map(async (ref) => {
        const d = await appDetail(ref.id);
        return {
          kind: "application" as const,
          ...ref,
          name: d.name ?? ref.id,
          appName: d.appName ?? "",
          status: d.applicationStatus ?? "idle",
          env: d.env ?? null,
        } satisfies ServiceSummary;
      })
    ),
    Promise.all(
      composeRefs.map(async (ref) => {
        const d = await composeDetail(ref.id);
        return {
          kind: "compose" as const,
          ...ref,
          name: d.name ?? ref.id,
          appName: d.appName ?? "",
          status: d.composeStatus ?? "idle",
          env: d.env ?? null,
        } satisfies ServiceSummary;
      })
    ),
  ]);

  return [...databases, ...applications, ...compose].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a free-text service query (id, exact appName/name, then substring)
 * to a single service. Throws a helpful error when ambiguous or missing.
 */
export async function findService(query: string): Promise<ServiceSummary> {
  const q = query.trim().toLowerCase();
  const services = await listServices();
  const exact =
    services.find((s) => s.id === query) ??
    services.find((s) => s.appName.toLowerCase() === q) ??
    services.find((s) => s.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = services.filter(
    (s) => s.name.toLowerCase().includes(q) || s.appName.toLowerCase().includes(q)
  );
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new Error(
      `"${query}" matches multiple services: ${partial.map((s) => s.name).join(", ")}. ` +
        "Use an exact name or id."
    );
  }
  throw new Error(`No service matches "${query}". Use list_services to see what exists.`);
}

// --- lifecycle --------------------------------------------------------------

export async function databaseAction(engine: Engine, id: string, action: Action): Promise<void> {
  await request(`${engine}.${action}`, { method: "POST", body: { [idKey(engine)]: id } });
}
export async function applicationAction(id: string, action: Action): Promise<void> {
  await request(`application.${action}`, { method: "POST", body: { applicationId: id } });
}
export async function composeAction(id: string, action: Action): Promise<void> {
  // compose uses delete instead of remove.
  const proc = action === "remove" ? "delete" : action;
  await request(`compose.${proc}`, { method: "POST", body: { composeId: id } });
}

/** Dispatch a lifecycle action against any resolved service. */
export async function serviceAction(service: ServiceSummary, action: Action): Promise<void> {
  if (service.kind === "database") return databaseAction(service.engine!, service.id, action);
  if (service.kind === "application") return applicationAction(service.id, action);
  return composeAction(service.id, action);
}

// --- applications -----------------------------------------------------------

export async function createApplication(name: string, environmentId: string): Promise<string> {
  const created = await request<{ applicationId: string }>("application.create", {
    method: "POST",
    body: { name, environmentId },
  });
  return created.applicationId;
}

export async function setAppDockerSource(applicationId: string, dockerImage: string): Promise<void> {
  await request("application.saveDockerProvider", {
    method: "POST",
    body: {
      applicationId,
      dockerImage,
      username: null,
      password: null,
      registryUrl: null,
    },
  });
}

/** Point an application at a public Git repo (Nixpacks build, no OAuth). */
export async function setAppGitSource(
  applicationId: string,
  url: string,
  branch = "main",
  buildPath = "/"
): Promise<void> {
  await request("application.saveGitProvider", {
    method: "POST",
    body: {
      applicationId,
      customGitUrl: url,
      customGitBranch: branch,
      customGitBuildPath: buildPath,
      watchPaths: [],
    },
  });
}

export async function saveApplicationEnvironment(id: string, env: string): Promise<void> {
  await request("application.saveEnvironment", {
    method: "POST",
    body: { applicationId: id, env, buildArgs: "", buildSecrets: "", createEnvFile: false },
  });
}

/** Create a domain (public URL) for an application, with Let's Encrypt HTTPS. */
export async function createDomain(applicationId: string, host: string, port = 80): Promise<void> {
  await request("domain.create", {
    method: "POST",
    body: { applicationId, host, port, https: true, certificateType: "letsencrypt" },
  });
}

/** Create + point + deploy an application from a Docker image. Returns a ref. */
export async function deployImage(
  image: string,
  name: string,
  environmentId: string
): Promise<ServiceRef> {
  const id = await createApplication(name, environmentId);
  await setAppDockerSource(id, image);
  await applicationAction(id, "deploy");
  const d = await appDetail(id);
  return { id, kind: "application", name: d.name ?? name, appName: d.appName ?? "" };
}

/** Create + point + deploy an application from a public Git repo. Returns a ref. */
export async function deployRepo(
  url: string,
  name: string,
  environmentId: string,
  branch = "main"
): Promise<ServiceRef> {
  const id = await createApplication(name, environmentId);
  await setAppGitSource(id, url, branch);
  await applicationAction(id, "deploy");
  const d = await appDetail(id);
  return { id, kind: "application", name: d.name ?? name, appName: d.appName ?? "" };
}

// --- compose ----------------------------------------------------------------

/** Create a raw docker-compose stack, seed its file, deploy. Returns a ref. */
export async function deployCompose(
  name: string,
  environmentId: string,
  composeFile: string
): Promise<ServiceRef> {
  const created = await request<{ composeId: string }>("compose.create", {
    method: "POST",
    body: { name, environmentId },
  });
  const id = created.composeId;
  await request("compose.update", {
    method: "POST",
    body: { composeId: id, sourceType: "raw", composeFile },
  });
  await composeAction(id, "deploy");
  const d = await composeDetail(id);
  return { id, kind: "compose", name: d.name ?? name, appName: d.appName ?? "" };
}

// --- databases --------------------------------------------------------------

export interface CreateDatabaseInput {
  engine: Engine;
  name: string;
  environmentId: string;
  databaseName?: string;
  databaseUser?: string;
  databasePassword: string;
  dockerImage?: string;
}

/** Create a database record. Returns the new id. Field set depends on the engine. */
export async function createDatabase(input: CreateDatabaseInput): Promise<string> {
  const { engine, name, environmentId, databasePassword, dockerImage } = input;
  const body: Record<string, unknown> = { name, environmentId, databasePassword };
  if (dockerImage) body.dockerImage = dockerImage;
  // redis has no databaseName/User; mongo has no databaseName.
  if (engine !== "redis") body.databaseUser = input.databaseUser ?? "admin";
  if (engine !== "redis" && engine !== "mongo") body.databaseName = input.databaseName ?? name;
  const created = await request<Record<string, string>>(`${engine}.create`, {
    method: "POST",
    body,
  });
  return created[idKey(engine)]!;
}

/** Replace a database's environment variables (raw "KEY=value" block). */
export async function saveDatabaseEnvironment(
  engine: Engine,
  id: string,
  env: string
): Promise<void> {
  await request(`${engine}.saveEnvironment`, {
    method: "POST",
    body: { [idKey(engine)]: id, env },
  });
}

/** Docker image base + curated latest tag per engine (mirrors dashboard ENGINE_META). */
export const ENGINE_IMAGE: Record<Engine, string> = {
  postgres: "postgres:18",
  mysql: "mysql:8.4",
  mariadb: "mariadb:11",
  mongo: "mongo:8",
  redis: "redis:7",
};
