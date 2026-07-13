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
// Origin header for better-auth's CSRF check. Dokploy only trusts its
// host-facing origins (e.g. http://localhost:3000) — when the BFF reaches it
// through container service DNS (DOKPLOY_URL=http://dokploy:3000), that URL
// is NOT a trusted origin, so the two must diverge. Defaults to BASE, which
// preserves dev-mode behavior.
const ORIGIN = process.env.DOKPLOY_ORIGIN ?? BASE;
const EMAIL = process.env.DOKPLOY_EMAIL ?? "";
const PASSWORD = process.env.DOKPLOY_PASSWORD ?? "";

export const ENGINES = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;
export type Engine = (typeof ENGINES)[number];

/** The id query/body key each engine uses, e.g. postgres -> postgresId. */
const idKey = (engine: Engine) => `${engine}Id` as const;

/** A deployable unit's lifecycle status (shared by all service kinds). */
export type ServiceStatus = "idle" | "running" | "done" | "error";
export type DatabaseStatus = ServiceStatus;

export type ServiceKind = "database" | "application" | "compose";

/** Fields common to every service kind — what the canvas/grid/drawer render. */
export interface ServiceBase {
  kind: ServiceKind;
  id: string;
  name: string;
  appName: string;
  status: ServiceStatus;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  dockerImage: string | null;
  /** Raw env block ("KEY=value\n..."). */
  env: string | null;
  createdAt: string | null;
  // Dokploy stores resource limits as Docker-format strings (e.g. "256m", "0.5").
  cpuLimit: string | null;
  memoryLimit: string | null;
  replicas: number | null;
}

export interface Database extends ServiceBase {
  kind: "database";
  engine: Engine;
  databaseName: string | null;
  databaseUser: string | null;
  databasePassword: string | null;
  externalPort: number | null;
  command: string | null;
}

export type AppSource = "github" | "gitlab" | "bitbucket" | "gitea" | "git" | "docker";

/** Build strategies Dokploy supports (the `buildType` pgEnum). */
export const BUILD_TYPES = [
  "nixpacks",
  "dockerfile",
  "railpack",
  "static",
  "heroku_buildpacks",
  "paketo_buildpacks",
] as const;
export type BuildType = (typeof BUILD_TYPES)[number];

export interface AppDomain {
  domainId: string;
  host: string;
  https: boolean;
  port: number | null;
  path: string | null;
}

export interface AppDeployment {
  deploymentId: string;
  status: string;
  title: string;
  createdAt: string;
}

export interface Application extends ServiceBase {
  kind: "application";
  sourceType: AppSource | null;
  buildType: BuildType | null;
  description: string | null;
  /** Source repo/image reference for display (git URL or owner/repo). */
  repository: string | null;
  // Build configuration (used to prefill the Build settings tab).
  dockerfile: string | null;
  dockerContextPath: string | null;
  dockerBuildStage: string | null;
  /** Custom start/run command appended to the container's entrypoint. */
  command: string | null;
  /** Registry host for docker-image apps (credentials are never read back). */
  registryUrl: string | null;
  domains: AppDomain[];
  deployments: AppDeployment[];
}

export interface ComposeService extends ServiceBase {
  kind: "compose";
  composeFile: string | null;
  composeType: string | null;
}

/** Any deployable service rendered in the dashboard. */
export type Service = Database | Application | ComposeService;

/** A directed connection between two services, inferred from env references. */
export interface ServiceEdge {
  source: string; // service id
  target: string; // service id
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
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
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
        Origin: ORIGIN,
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

/**
 * Cheapest end-to-end probe: signs in (when there is no cached session) and
 * lists projects. Used by /api/health?deep=1 so the installer can verify the
 * container -> Dokploy path without parsing the workspace.
 */
export async function ping(): Promise<void> {
  await request("project.all");
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
  applications: { applicationId: string }[];
  compose: { composeId: string }[];
}
interface RawProject {
  projectId: string;
  name: string;
  environments: RawEnvironment[];
}

async function rawTree(): Promise<RawProject[]> {
  return request<RawProject[]>("project.all");
}

/** The project/environment scope every service carries. */
type Scope = Pick<
  ServiceBase,
  "projectId" | "projectName" | "environmentId" | "environmentName"
>;

/** Flatten the tree into per-service refs: one {id + scope} per extracted id. */
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

function projectsFromTree(tree: RawProject[]): ProjectNode[] {
  return tree.map((p) => ({
    projectId: p.projectId,
    name: p.name,
    environments: p.environments.map((e) => ({
      environmentId: e.environmentId,
      name: e.name,
    })),
  }));
}

export async function listProjects(): Promise<ProjectNode[]> {
  return projectsFromTree(await rawTree());
}

export async function createProject(name: string): Promise<void> {
  await request("project.create", { method: "POST", body: { name } });
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  await request("project.update", { method: "POST", body: { projectId, name } });
}

export async function removeProject(projectId: string): Promise<void> {
  await request("project.remove", { method: "POST", body: { projectId } });
}

export async function createEnvironment(projectId: string, name: string): Promise<void> {
  await request("environment.create", { method: "POST", body: { projectId, name } });
}

export async function renameEnvironment(environmentId: string, name: string): Promise<void> {
  await request("environment.update", { method: "POST", body: { environmentId, name } });
}

export async function removeEnvironment(environmentId: string): Promise<void> {
  await request("environment.remove", { method: "POST", body: { environmentId } });
}

// --- databases --------------------------------------------------------------

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
  cpuLimit?: string | null;
  memoryLimit?: string | null;
  command?: string | null;
  replicas?: number | null;
}

async function getDetail(engine: Engine, id: string): Promise<RawDatabaseDetail> {
  return request<RawDatabaseDetail>(`${engine}.one?${idKey(engine)}=${encodeURIComponent(id)}`);
}

/** List every database in the tree, enriched with detail. */
async function listDatabases(tree: RawProject[]): Promise<Database[]> {
  const summaries = ENGINES.flatMap((engine) =>
    collectIds(tree, (env) =>
      ((env[engine] ?? []) as Record<string, string>[]).map((item) => item[idKey(engine)])
    ).map((ref) => ({ ...ref, engine }))
  );
  const detailed = await Promise.all(
    summaries.map(async (s) => {
      const d = await getDetail(s.engine, s.id);
      return {
        ...s,
        kind: "database",
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
export function inferEdges(services: Service[]): ServiceEdge[] {
  const edges: ServiceEdge[] = [];
  const seen = new Set<string>();
  for (const a of services) {
    const haystack = (a.env ?? "").toLowerCase();
    if (!haystack) continue;
    for (const b of services) {
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

/** Create a database record. Returns the new id. Field set depends on the engine. */
export async function createDatabase(input: CreateDatabaseInput): Promise<string> {
  const { engine, name, environmentId, databasePassword, dockerImage } = input;
  const body: Record<string, unknown> = { name, environmentId, databasePassword };
  if (dockerImage) body.dockerImage = dockerImage;
  // redis has no databaseName/User; mongo has no databaseName.
  if (engine !== "redis") body.databaseUser = input.databaseUser ?? "admin";
  if (engine !== "redis" && engine !== "mongo")
    body.databaseName = input.databaseName ?? name;
  const created = await request<Record<string, string>>(`${engine}.create`, {
    method: "POST",
    body,
  });
  return created[idKey(engine)];
}

/** Lifecycle actions shared by every service kind. */
export type Action = "deploy" | "start" | "stop" | "remove";

/** Run a lifecycle action against a database. */
export async function databaseAction(engine: Engine, id: string, action: Action): Promise<void> {
  await request(`${engine}.${action}`, {
    method: "POST",
    body: { [idKey(engine)]: id },
  });
}

/** Editable settings on a database (verified accepted by `<engine>.update`). */
export interface DatabasePatch {
  name?: string;
  dockerImage?: string;
  externalPort?: number | null;
  cpuLimit?: string | null;
  memoryLimit?: string | null;
}

/** Patch a database's settings. Image/resource changes need a reload to apply. */
export async function updateDatabase(
  engine: Engine,
  id: string,
  patch: DatabasePatch
): Promise<void> {
  const { externalPort, ...rest } = patch;
  await request(`${engine}.update`, {
    method: "POST",
    body: { [idKey(engine)]: id, ...rest },
  });
  // External port lives on a dedicated endpoint.
  if (externalPort !== undefined) {
    await request(`${engine}.saveExternalPort`, {
      method: "POST",
      body: { [idKey(engine)]: id, externalPort },
    });
  }
}

/** Re-apply a database's config to its running container. */
export async function reloadDatabase(engine: Engine, id: string, appName: string): Promise<void> {
  await request(`${engine}.reload`, {
    method: "POST",
    body: { [idKey(engine)]: id, appName },
  });
}

// --- applications -----------------------------------------------------------

interface RawApplicationDetail {
  name?: string;
  appName?: string;
  applicationStatus?: ServiceStatus;
  sourceType?: AppSource | null;
  buildType?: BuildType | null;
  description?: string | null;
  customGitUrl?: string | null;
  owner?: string | null;
  repository?: string | null;
  dockerImage?: string | null;
  dockerfile?: string | null;
  dockerContextPath?: string | null;
  dockerBuildStage?: string | null;
  command?: string | null;
  registryUrl?: string | null;
  env?: string | null;
  createdAt?: string | null;
  cpuLimit?: string | null;
  memoryLimit?: string | null;
  replicas?: number | null;
  domains?: {
    domainId: string;
    host: string;
    https?: boolean;
    port?: number | null;
    path?: string | null;
  }[];
  deployments?: { deploymentId: string; status?: string; title?: string; createdAt?: string }[];
}

/** List every application in the tree, enriched with detail. */
async function listApplications(tree: RawProject[]): Promise<Application[]> {
  const refs = collectIds(tree, (env) => (env.applications ?? []).map((a) => a.applicationId));
  return Promise.all(
    refs.map(async ({ id, ...scope }) => {
      const d = await request<RawApplicationDetail>(
        `application.one?applicationId=${encodeURIComponent(id)}`
      );
      return {
        ...scope,
        kind: "application",
        id,
        name: d.name ?? id,
        appName: d.appName ?? "",
        status: d.applicationStatus ?? "idle",
        sourceType: d.sourceType ?? null,
        buildType: d.buildType ?? null,
        description: d.description ?? null,
        repository:
          d.customGitUrl ?? (d.owner && d.repository ? `${d.owner}/${d.repository}` : null),
        dockerImage: d.dockerImage ?? null,
        dockerfile: d.dockerfile ?? null,
        dockerContextPath: d.dockerContextPath ?? null,
        dockerBuildStage: d.dockerBuildStage ?? null,
        command: d.command ?? null,
        registryUrl: d.registryUrl ?? null,
        env: d.env ?? null,
        createdAt: d.createdAt ?? null,
        cpuLimit: d.cpuLimit ?? null,
        memoryLimit: d.memoryLimit ?? null,
        replicas: d.replicas ?? null,
        domains: (d.domains ?? []).map((dm) => ({
          domainId: dm.domainId,
          host: dm.host,
          https: dm.https ?? false,
          port: dm.port ?? null,
          path: dm.path ?? null,
        })),
        deployments: (d.deployments ?? []).map((dp) => ({
          deploymentId: dp.deploymentId,
          status: dp.status ?? "idle",
          title: dp.title ?? "Deployment",
          createdAt: dp.createdAt ?? "",
        })),
      } satisfies Application;
    })
  );
}

/** Create an empty application. Returns the new id. */
export async function createApplication(name: string, environmentId: string): Promise<string> {
  const created = await request<{ applicationId: string }>("application.create", {
    method: "POST",
    body: { name, environmentId },
  });
  return created.applicationId;
}

/** Point an application at a public/private Docker image. */
export async function setAppDockerSource(
  applicationId: string,
  dockerImage: string,
  registry?: { username: string; password: string; registryUrl: string }
): Promise<void> {
  await request("application.saveDockerProvider", {
    method: "POST",
    body: {
      applicationId,
      dockerImage,
      username: registry?.username ?? null,
      password: registry?.password ?? null,
      registryUrl: registry?.registryUrl ?? null,
    },
  });
}

/**
 * Point an application at a public Git repository (built with Nixpacks, the
 * default build type). No OAuth needed — uses a plain clone URL.
 */
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

export interface ApplicationPatch {
  name?: string;
  description?: string;
  cpuLimit?: string | null;
  memoryLimit?: string | null;
  command?: string | null;
}

export async function updateApplication(id: string, patch: ApplicationPatch): Promise<void> {
  await request("application.update", { method: "POST", body: { applicationId: id, ...patch } });
}

/** Build-strategy settings applied by `application.saveBuildType`. */
export interface BuildTypePatch {
  buildType: BuildType;
  /** Dockerfile-build fields (ignored by other strategies). */
  dockerfile?: string;
  dockerContextPath?: string | null;
  dockerBuildStage?: string | null;
  railpackVersion?: string;
  herokuVersion?: string;
  publishDirectory?: string | null;
  isStaticSpa?: boolean;
}

/**
 * Set an application's build strategy (Nixpacks / Dockerfile / Railpack / …).
 * `application.saveBuildType` requires the Dockerfile and version fields on every
 * call (apiSaveBuildType marks them required), so we fill Dokploy's own defaults
 * for whatever the caller omits. Takes effect on the next deploy.
 */
export async function saveAppBuildType(id: string, patch: BuildTypePatch): Promise<void> {
  const body: Record<string, unknown> = {
    applicationId: id,
    buildType: patch.buildType,
    dockerfile: patch.dockerfile?.trim() || "Dockerfile",
    dockerContextPath: patch.dockerContextPath ?? null,
    dockerBuildStage: patch.dockerBuildStage ?? null,
    herokuVersion: patch.herokuVersion ?? "24",
    railpackVersion: patch.railpackVersion ?? "0.15.4",
  };
  // publishDirectory/isStaticSpa are optional strings/booleans — omit when unset
  // (null would fail their non-nullable zod schema).
  if (patch.publishDirectory != null) body.publishDirectory = patch.publishDirectory;
  if (patch.isStaticSpa !== undefined) body.isStaticSpa = patch.isStaticSpa;
  await request("application.saveBuildType", { method: "POST", body });
}

export async function saveApplicationEnvironment(id: string, env: string): Promise<void> {
  // application.saveEnvironment also accepts build args/secrets; send empty.
  await request("application.saveEnvironment", {
    method: "POST",
    body: { applicationId: id, env, buildArgs: "", buildSecrets: "", createEnvFile: false },
  });
}

export async function applicationAction(id: string, action: Action): Promise<void> {
  await request(`application.${action}`, { method: "POST", body: { applicationId: id } });
}

/** Create a domain (public URL) for an application. */
export async function createDomain(applicationId: string, host: string, port = 80): Promise<void> {
  await request("domain.create", {
    method: "POST",
    body: { applicationId, host, port, https: true, certificateType: "letsencrypt" },
  });
}

// --- compose ----------------------------------------------------------------

interface RawComposeDetail {
  name?: string;
  appName?: string;
  composeStatus?: ServiceStatus;
  composeType?: string | null;
  composeFile?: string | null;
  env?: string | null;
  createdAt?: string | null;
}

export const STARTER_COMPOSE = `services:
  web:
    image: nginx:alpine
    ports:
      - 8080:80
`;

/** List every compose stack in the tree, enriched with detail. */
async function listCompose(tree: RawProject[]): Promise<ComposeService[]> {
  const refs = collectIds(tree, (env) => (env.compose ?? []).map((c) => c.composeId));
  return Promise.all(
    refs.map(async ({ id, ...scope }) => {
      const d = await request<RawComposeDetail>(
        `compose.one?composeId=${encodeURIComponent(id)}`
      );
      return {
        ...scope,
        kind: "compose",
        id,
        name: d.name ?? id,
        appName: d.appName ?? "",
        status: d.composeStatus ?? "idle",
        dockerImage: null,
        env: d.env ?? null,
        createdAt: d.createdAt ?? null,
        cpuLimit: null,
        memoryLimit: null,
        replicas: null,
        composeFile: d.composeFile ?? null,
        composeType: d.composeType ?? null,
      } satisfies ComposeService;
    })
  );
}

/** Create a raw docker-compose stack and seed its file. Returns the new id. */
export async function createCompose(
  name: string,
  environmentId: string,
  composeFile = STARTER_COMPOSE
): Promise<string> {
  const created = await request<{ composeId: string }>("compose.create", {
    method: "POST",
    body: { name, environmentId },
  });
  await request("compose.update", {
    method: "POST",
    body: { composeId: created.composeId, sourceType: "raw", composeFile },
  });
  return created.composeId;
}

export async function updateComposeFile(id: string, composeFile: string): Promise<void> {
  await request("compose.update", { method: "POST", body: { composeId: id, composeFile } });
}

export async function composeAction(id: string, action: Action): Promise<void> {
  // compose uses delete instead of remove.
  const proc = action === "remove" ? "delete" : action;
  await request(`compose.${proc}`, { method: "POST", body: { composeId: id } });
}

// --- unified service listing ------------------------------------------------

/**
 * Everything the workspace page needs, from a single `project.all` fetch:
 * services of all kinds (enriched with per-service detail) plus the
 * project/environment tree.
 */
export async function loadWorkspace(): Promise<{
  services: Service[];
  projects: ProjectNode[];
}> {
  const tree = await rawTree();
  const [databases, applications, compose] = await Promise.all([
    listDatabases(tree),
    listApplications(tree),
    listCompose(tree),
  ]);
  const services = [...databases, ...applications, ...compose].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  return { services, projects: projectsFromTree(tree) };
}
