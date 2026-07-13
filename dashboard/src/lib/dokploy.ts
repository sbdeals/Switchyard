/**
 * Server-only client for the Dokploy API.
 *
 * Auth model: the dashboard is a backend-for-frontend with a PER-USER login.
 * Each user signs in with their OWN Dokploy account (`/login`); we hold their
 * Dokploy session cookie inside a sealed Switchyard session cookie and use it
 * for every request THAT user makes (`request()` -> `userCookie()`, read from
 * next/headers). The raw Dokploy cookie never reaches the browser. On a Dokploy
 * 401 we bounce the user to /login rather than escalating privilege.
 *
 * The env admin credentials (`DOKPLOY_EMAIL`/`DOKPLOY_PASSWORD`) survive for a
 * SINGLE purpose: the system self-probe `ping()` behind /api/health?deep=1,
 * which the installer uses to prove the container -> Dokploy path. That admin
 * session is never used to serve user requests.
 *
 * Dokploy models a database as a service nested under project -> environment.
 * `project.all` returns the tree but trims nested service objects down to their
 * IDs, so we enrich each database via `<engine>.one`.
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, openSession } from "./session";

const BASE = process.env.DOKPLOY_URL ?? "http://localhost:3000";
// Origin header for better-auth's CSRF check. Dokploy only trusts its
// host-facing origins (e.g. http://localhost:3000) — when the BFF reaches it
// through container service DNS (DOKPLOY_URL=http://dokploy:3000), that URL
// is NOT a trusted origin, so the two must diverge. Defaults to BASE, which
// preserves dev-mode behavior.
const ORIGIN = process.env.DOKPLOY_ORIGIN ?? BASE;
const EMAIL = process.env.DOKPLOY_EMAIL ?? "";
const PASSWORD = process.env.DOKPLOY_PASSWORD ?? "";

// Host-facing base for Dokploy's own deploy webhook (`/api/deploy/<token>`).
// The BFF reaches Dokploy over service DNS (DOKPLOY_URL), which a Git host
// cannot resolve, so prefer the host-facing origin. Even so, if Dokploy sits
// behind a public domain the user must swap this host — surfaced as a note in
// the Deploys tab. Trailing slashes trimmed so URL joins stay clean.
const WEBHOOK_BASE = (process.env.DOKPLOY_ORIGIN ?? BASE).replace(/\/+$/, "");

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
  /**
   * Non-null when this deployment produced a restorable image snapshot
   * (Dokploy only records these when the app deploys to a registry). Feeds
   * the Deploys-tab rollback control; see `rollbackToDeployment`.
   */
  rollbackId: string | null;
}

export interface Application extends ServiceBase {
  kind: "application";
  sourceType: AppSource | null;
  buildType: string | null;
  description: string | null;
  /** Source repo/image reference for display (git URL or owner/repo). */
  repository: string | null;
  domains: AppDomain[];
  deployments: AppDeployment[];
  // --- push-to-deploy config (custom-git source); see setAppGitSource ---------
  /** When true, hitting the deploy webhook redeploys the app. */
  autoDeploy: boolean;
  /** Branch the webhook must match to trigger a deploy (customGitBranch). */
  branch: string | null;
  /** Build path within the repo (customGitBuildPath). */
  buildPath: string | null;
  /** Raw clone URL for a custom-git source (customGitUrl), else null. */
  gitUrl: string | null;
  /** Sub-paths that gate a webhook deploy; empty means "any change". */
  watchPaths: string[];
  /**
   * Dokploy's own per-app deploy webhook to wire into a Git host, or null if
   * the app has no refresh token. This is a Dokploy route, not a Switchyard
   * one, so it is reachable independently of any dashboard auth.
   */
  webhookUrl: string | null;
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

/**
 * Sign into Dokploy and return the session cookie as a "name=value; ..." string
 * (attributes like Path/HttpOnly stripped). Shared by the per-user login flow
 * (src/app/login/actions.ts) and the admin system probe below.
 */
export async function signInToDokploy(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dokploy sign-in failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Dokploy sign-in returned no session cookie");
  // Keep just the cookie name=value pairs (drop attributes like Path/HttpOnly).
  return setCookie
    .split(/,(?=[^;]+=[^;]+)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");
}

/**
 * Register a Dokploy account (better-auth sign-up) — the same call the CLI's
 * terminal-guided registration makes (cli/src/core/dokploy-api.ts). On a fresh
 * install the first sign-up becomes the admin; Dokploy rejects the call once
 * registration is closed.
 */
export async function signUpToDokploy(
  name: string,
  email: string,
  password: string
): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ name, email, password }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dokploy sign-up failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

/**
 * The CURRENT user's Dokploy cookie, read from the sealed Switchyard session.
 * The proxy blocks anonymous requests up front, so reaching here without a
 * valid session means the cookie is forged/expired -> send them to /login.
 * `redirect()` throws NEXT_REDIRECT (never returns), so the return type holds.
 */
async function userCookie(): Promise<string> {
  const store = await cookies();
  const session = openSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  return session.dokployCookie;
}

type ReqInit = { method?: "GET" | "POST"; body?: unknown };

/**
 * User-serving Dokploy request. Threads the per-user cookie via next/headers so
 * the call signature stays `request(path, init)` for every existing caller. On
 * a Dokploy 401 the user's session has expired -> redirect to /login (we do NOT
 * silently fall back to the admin session).
 */
async function request<T>(path: string, init: ReqInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Cookie: await userCookie(),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dokploy ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// --- system probe (admin session) -------------------------------------------
// The ONLY consumer of the env admin credentials. Kept fully separate from the
// user-serving path above so an anonymous /api/health?deep=1 probe still works.

let adminCookieCache: string | null = null;

async function adminSignIn(): Promise<string> {
  adminCookieCache = await signInToDokploy(EMAIL, PASSWORD);
  return adminCookieCache;
}

/**
 * Cheapest end-to-end probe: admin sign-in (when uncached) + list projects.
 * Used by /api/health?deep=1 so the installer can verify the container ->
 * Dokploy path without parsing the workspace or needing a logged-in user.
 */
export async function ping(): Promise<void> {
  const doFetch = (cookie: string) =>
    fetch(`${BASE}/api/project.all`, {
      method: "GET",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
      cache: "no-store",
    });
  let res = await doFetch(adminCookieCache ?? (await adminSignIn()));
  if (res.status === 401) {
    adminCookieCache = null;
    res = await doFetch(await adminSignIn());
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dokploy project.all failed (${res.status}): ${body.slice(0, 300)}`);
  }
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
  buildType?: string | null;
  description?: string | null;
  customGitUrl?: string | null;
  customGitBranch?: string | null;
  customGitBuildPath?: string | null;
  watchPaths?: string[] | null;
  autoDeploy?: boolean | null;
  refreshToken?: string | null;
  owner?: string | null;
  repository?: string | null;
  dockerImage?: string | null;
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
  deployments?: {
    deploymentId: string;
    status?: string;
    title?: string;
    createdAt?: string;
    rollbackId?: string | null;
  }[];
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
          rollbackId: dp.rollbackId ?? null,
        })),
        autoDeploy: d.autoDeploy ?? false,
        branch: d.customGitBranch ?? null,
        buildPath: d.customGitBuildPath ?? null,
        gitUrl: d.customGitUrl ?? null,
        watchPaths: d.watchPaths ?? [],
        webhookUrl: d.refreshToken
          ? `${WEBHOOK_BASE}/api/deploy/${d.refreshToken}`
          : null,
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
 *
 * `watchPaths` is additive/defaulted so existing call sites are unaffected: an
 * empty list means the deploy webhook fires on any change; a non-empty list
 * restricts it to matching sub-paths (Dokploy's `watchPaths` semantics).
 */
export async function setAppGitSource(
  applicationId: string,
  url: string,
  branch = "main",
  buildPath = "/",
  watchPaths: string[] = []
): Promise<void> {
  await request("application.saveGitProvider", {
    method: "POST",
    body: {
      applicationId,
      customGitUrl: url,
      customGitBranch: branch,
      customGitBuildPath: buildPath,
      watchPaths,
    },
  });
}

// --- push-to-deploy + rollback ----------------------------------------------
// (Added for the Deploys tab. Kept in their own section so the existing
//  application exports above stay untouched.)

/**
 * Enable/disable auto-deploy for an application. When enabled, Dokploy's deploy
 * webhook (`webhookUrl`) triggers a redeploy on push; when disabled the webhook
 * returns 400. `autoDeploy` rides on `application.update` (verified accepted by
 * the `apiUpdateApplication` schema).
 */
export async function setAppAutoDeploy(
  applicationId: string,
  autoDeploy: boolean
): Promise<void> {
  await request("application.update", {
    method: "POST",
    body: { applicationId, autoDeploy },
  });
}

/**
 * Roll an application back to a previous deployment's image snapshot.
 *
 * Dokploy rollbacks are image-based: a deployment only has a `rollbackId` when
 * it was pushed to a registry (rollbacks must be enabled with a registry on the
 * app). This calls Dokploy's `rollback.rollback`, which restores the recorded
 * image for that snapshot. There is no git/commit-level rollback in Dokploy —
 * for Nixpacks apps without a registry, `rollbackId` is null and nothing is
 * rollbackable.
 */
export async function rollbackToDeployment(rollbackId: string): Promise<void> {
  await request("rollback.rollback", {
    method: "POST",
    body: { rollbackId },
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

// --- auto-URL: mint a reachable public URL on deploy ------------------------
//
// On the Linux path Dokploy runs Traefik on 80/443 and can route a wildcard
// host that resolves to the host IP with no DNS setup. We prefer Dokploy's
// built-in `domain.generateDomain`, which returns a `*.traefik.me` host
// (`<appName>-<rand>.<hostIP>.traefik.me`). traefik.me domains are served over
// a shared cert, so they are created with certificateType "none" (a Let's
// Encrypt request for traefik.me just hits rate limits and fails). When Dokploy
// can't produce a usable host (e.g. it couldn't detect the server IP) we fall
// back to `<appName>.<SWITCHYARD_HOST_IP>.sslip.io` — the CLI hands us the
// host's advertise IP — and request a real Let's Encrypt cert for it.
//
// The whole feature is gated on SWITCHYARD_HOST_IP, which the CLI sets only on
// the Linux platform (where Traefik is managed). On Docker Desktop and in dev
// mode it is unset, so auto-URL is a no-op and a deploy simply leaves the app
// without a domain.

/** Container port auto-domains route to (Nixpacks/Node apps default here). */
const AUTO_DOMAIN_PORT = 3000;

/** True for hosts we mint automatically (traefik.me / sslip.io wildcards). */
export function isAutoDomainHost(host: string): boolean {
  return /\.traefik\.me$|\.sslip\.io$/i.test(host.trim());
}

/** A generated host is usable only if it carries a real, routable IP. */
function usableGeneratedHost(host: string): boolean {
  const h = host.trim();
  if (!h || !h.includes(".") || h.includes("..")) return false;
  // Reject a loopback/empty IP segment — Dokploy failed to detect the server IP.
  return !/\.(127\.0\.0\.1|0\.0\.0\.0|localhost)\./i.test(h);
}

/**
 * Ask Dokploy for a generated `*.traefik.me` host for `appName`. Returns the
 * bare hostname, or null when the procedure is unavailable / returns nothing
 * usable. `domain.generateDomain` only computes a host string — it does not
 * persist a domain, so the caller still creates one.
 */
async function generateTraefikMeHost(appName: string): Promise<string | null> {
  try {
    const res = await request<unknown>("domain.generateDomain", {
      method: "POST",
      body: { appName },
    });
    const host =
      typeof res === "string"
        ? res
        : ((res as { domain?: string; host?: string } | null)?.domain ??
          (res as { host?: string } | null)?.host ??
          null);
    return host && usableGeneratedHost(host) ? host.trim() : null;
  } catch {
    return null;
  }
}

/** Create a domain with an explicit cert type (used by the auto-URL variants). */
async function createDomainRecord(
  applicationId: string,
  host: string,
  certificateType: "none" | "letsencrypt"
): Promise<void> {
  await request("domain.create", {
    method: "POST",
    body: { applicationId, host, port: AUTO_DOMAIN_PORT, https: true, certificateType },
  });
}

/**
 * Mint a public URL for a freshly-deployed application and return its host, or
 * null when auto-URL isn't available (no SWITCHYARD_HOST_IP → Docker Desktop /
 * dev). Idempotent: if the app already carries an auto-domain the existing host
 * is returned without creating a second one.
 */
export async function ensureAutoDomain(applicationId: string): Promise<string | null> {
  const hostIp = process.env.SWITCHYARD_HOST_IP?.trim();
  if (!hostIp) return null; // Docker Desktop / dev: Traefik unmanaged, no-op.

  // One call gives us both the appName (for the generator / sslip.io host) and
  // the current domains (so redeploys don't stack duplicate auto-domains).
  const detail = await request<RawApplicationDetail>(
    `application.one?applicationId=${encodeURIComponent(applicationId)}`
  );
  const appName = detail.appName ?? "";
  if (!appName) return null;
  const existing = (detail.domains ?? []).find((d) => isAutoDomainHost(d.host));
  if (existing) return existing.host;

  const generated = await generateTraefikMeHost(appName);
  if (generated) {
    await createDomainRecord(applicationId, generated, "none");
    return generated;
  }
  const host = `${appName}.${hostIp}.sslip.io`;
  await createDomainRecord(applicationId, host, "letsencrypt");
  return host;
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

// --- backups (S3 destinations + scheduled database backups) -----------------
//
// Dokploy models offsite backups in two layers:
//   1. S3 "destinations" — org-wide bucket credentials (`destination.*`).
//   2. per-database "backups" — a cron schedule + prefix pointed at a
//      destination, plus a manual "run now" and a restore.
//
// Everything here rides the same OpenAPI REST layer (`/api/<procedure>`,
// plain JSON) as the rest of this file — EXCEPT restore. Dokploy exposes
// restore ONLY as a tRPC *subscription* (`backup.restoreBackupWithLogs`, with
// its OpenAPI mapping explicitly disabled); see restoreBackup() below.
//
// Backups apply to the four dumpable engines only — Dokploy's `databaseType`
// enum has no `redis` (Redis is not backed up this way).

export type BackupEngine = Exclude<Engine, "redis">;

/** Dokploy's per-engine "manual backup" procedure names (note the casing). */
const MANUAL_BACKUP_PROC: Record<BackupEngine, string> = {
  postgres: "manualBackupPostgres",
  mysql: "manualBackupMySql",
  mariadb: "manualBackupMariadb",
  mongo: "manualBackupMongo",
};

export interface S3Destination {
  destinationId: string;
  name: string;
  provider: string | null;
  bucket: string;
  region: string;
  endpoint: string;
}

interface RawDestination {
  destinationId: string;
  name: string;
  provider?: string | null;
  bucket?: string;
  region?: string;
  endpoint?: string;
}

/** List the org's configured S3 destinations (credentials omitted). */
export async function listDestinations(): Promise<S3Destination[]> {
  const raw = await request<RawDestination[]>("destination.all");
  return (raw ?? []).map((d) => ({
    destinationId: d.destinationId,
    name: d.name,
    provider: d.provider ?? null,
    bucket: d.bucket ?? "",
    region: d.region ?? "",
    endpoint: d.endpoint ?? "",
  }));
}

export interface CreateDestinationInput {
  name: string;
  /** S3 access key id. Entered by the operator; passed straight to Dokploy. */
  accessKey: string;
  /** S3 secret access key. Never logged or returned to the client. */
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint: string;
  provider?: string;
}

function destinationBody(input: CreateDestinationInput): Record<string, unknown> {
  return {
    name: input.name,
    provider: input.provider ?? "",
    accessKey: input.accessKey,
    secretAccessKey: input.secretAccessKey,
    bucket: input.bucket,
    region: input.region,
    endpoint: input.endpoint,
    additionalFlags: [],
  };
}

/** Dry-run a destination's credentials without persisting it. */
export async function testDestination(input: CreateDestinationInput): Promise<void> {
  await request("destination.testConnection", { method: "POST", body: destinationBody(input) });
}

/** Persist a new S3 destination for the org. */
export async function createDestination(input: CreateDestinationInput): Promise<void> {
  await request("destination.create", { method: "POST", body: destinationBody(input) });
}

export async function removeDestination(destinationId: string): Promise<void> {
  await request("destination.remove", { method: "POST", body: { destinationId } });
}

export interface DatabaseBackup {
  backupId: string;
  schedule: string;
  enabled: boolean;
  /** The database name this backup dumps. */
  database: string;
  /** S3 key prefix the dumps are written under. */
  prefix: string;
  keepLatestCount: number | null;
  destinationId: string;
  destinationName: string | null;
}

interface RawBackup {
  backupId: string;
  schedule: string;
  enabled?: boolean | null;
  database: string;
  prefix: string;
  keepLatestCount?: number | null;
  destinationId: string;
  destination?: { name?: string } | null;
}
interface RawDbWithBackups {
  backups?: RawBackup[];
}

/** List a database's configured backups (read from its `<engine>.one` detail). */
export async function listDatabaseBackups(
  engine: BackupEngine,
  id: string
): Promise<DatabaseBackup[]> {
  const detail = await request<RawDbWithBackups>(
    `${engine}.one?${idKey(engine)}=${encodeURIComponent(id)}`
  );
  return (detail.backups ?? []).map((b) => ({
    backupId: b.backupId,
    schedule: b.schedule,
    enabled: b.enabled ?? false,
    database: b.database,
    prefix: b.prefix,
    keepLatestCount: b.keepLatestCount ?? null,
    destinationId: b.destinationId,
    destinationName: b.destination?.name ?? null,
  }));
}

export interface CreateBackupInput {
  engine: BackupEngine;
  databaseId: string;
  destinationId: string;
  /** Database name to dump. */
  database: string;
  /** Cron expression. */
  schedule: string;
  /** S3 key prefix. */
  prefix: string;
  enabled: boolean;
  keepLatestCount?: number | null;
}

/** Create a scheduled backup for a database. */
export async function createDatabaseBackup(input: CreateBackupInput): Promise<void> {
  await request("backup.create", {
    method: "POST",
    body: {
      [idKey(input.engine)]: input.databaseId,
      // For these four engines the `databaseType` enum equals the engine name.
      databaseType: input.engine,
      backupType: "database",
      destinationId: input.destinationId,
      database: input.database,
      schedule: input.schedule,
      prefix: input.prefix,
      enabled: input.enabled,
      keepLatestCount: input.keepLatestCount ?? undefined,
    },
  });
}

export interface UpdateBackupInput {
  backupId: string;
  engine: BackupEngine;
  destinationId: string;
  database: string;
  schedule: string;
  prefix: string;
  enabled: boolean;
  keepLatestCount?: number | null;
}

/** Update an existing backup (used e.g. to toggle `enabled` or change schedule). */
export async function updateDatabaseBackup(input: UpdateBackupInput): Promise<void> {
  // `apiUpdateBackup` marks every picked field required, including the nullable
  // `serviceName`/`metadata` (compose-only) — send explicit nulls for those.
  await request("backup.update", {
    method: "POST",
    body: {
      backupId: input.backupId,
      databaseType: input.engine,
      destinationId: input.destinationId,
      database: input.database,
      schedule: input.schedule,
      prefix: input.prefix,
      enabled: input.enabled,
      keepLatestCount: input.keepLatestCount ?? 0,
      serviceName: null,
      metadata: null,
    },
  });
}

export async function removeDatabaseBackup(backupId: string): Promise<void> {
  await request("backup.remove", { method: "POST", body: { backupId } });
}

/** Trigger an immediate ("back up now") run of a configured backup. */
export async function runDatabaseBackup(engine: BackupEngine, backupId: string): Promise<void> {
  await request(`backup.${MANUAL_BACKUP_PROC[engine]}`, {
    method: "POST",
    body: { backupId },
  });
}

export interface BackupFile {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
}

interface RawRcloneFile {
  Path: string;
  Name: string;
  Size: number;
  IsDir: boolean;
}

/** List objects in a destination's bucket (for picking a file to restore). */
export async function listBackupFiles(
  destinationId: string,
  search = ""
): Promise<BackupFile[]> {
  const raw = await request<RawRcloneFile[]>(
    `backup.listBackupFiles?destinationId=${encodeURIComponent(destinationId)}&search=${encodeURIComponent(search)}`
  );
  return (raw ?? []).map((f) => ({
    path: f.Path,
    name: f.Name,
    size: f.Size,
    isDir: f.IsDir,
  }));
}

export interface RestoreBackupInput {
  engine: BackupEngine;
  /** Id of the database to restore INTO. */
  databaseId: string;
  /** Target database name to restore into. */
  databaseName: string;
  /** S3 object path (from listBackupFiles) to restore from. */
  backupFile: string;
  destinationId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Restore a backup into a database.
 *
 * IMPORTANT: Dokploy exposes restore ONLY as a tRPC *subscription*
 * (`backup.restoreBackupWithLogs`) whose OpenAPI/REST mapping is explicitly
 * disabled — there is no plain REST mutation. Dokploy's own UI drives it over a
 * WebSocket (`/drawer-logs`, superjson-encoded). To avoid adding a WebSocket
 * client, we consume the SAME procedure over tRPC v11's SSE transport on the
 * standard `/api/trpc` handler, reusing this BFF's cookie auth, and read the
 * stream to completion (the restore executes server-side as we drain it). The
 * subscription generator prepends `Error: ...` to the log stream on failure,
 * which we surface. This path is unverified against a live Dokploy; if the SSE
 * transport is rejected, a `ws` client against `/drawer-logs` is the fallback.
 */
export async function restoreBackup(input: RestoreBackupInput): Promise<void> {
  const payload = {
    databaseId: input.databaseId,
    databaseType: input.engine,
    backupType: "database",
    databaseName: input.databaseName,
    backupFile: input.backupFile,
    destinationId: input.destinationId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
  // tRPC applies superjson to subscription inputs; for this all-plain payload
  // the superjson envelope is simply `{ json: payload }` (no `meta`).
  const inputParam = encodeURIComponent(JSON.stringify({ json: payload }));
  const url = `${BASE}/api/trpc/backup.restoreBackupWithLogs?input=${inputParam}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/event-stream", Origin: ORIGIN, Cookie: await userCookie() },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dokploy restore failed (${res.status}): ${body.slice(0, 300)}`);
  }
  // Drain the stream to EOF — the subscription closes when the restore finishes.
  const text = await res.text();
  const err = text.match(/Error:\s*([^"\\\n]+)/);
  if (err) throw new Error(err[1].trim().slice(0, 300));
}

// --- templates (one-click catalog) ------------------------------------------

/**
 * A catalog entry from Dokploy's open-source template library (Plausible, n8n,
 * Postgres+app bundles, ...). Each template is a bundled docker-compose stack.
 * Shape mirrors Dokploy's `compose.templates` result (its template meta.json).
 */
export interface DokployTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  logo: string;
  tags: string[];
  links: { github: string; website?: string; docs?: string };
}

/**
 * List the available one-click templates via Dokploy's `compose.templates`.
 * Dokploy fetches this list from its templates repo (templates.dokploy.com) at
 * request time, so this needs outbound internet from the Dokploy host; Dokploy
 * returns an empty array when that upstream fetch fails.
 */
export async function listTemplates(): Promise<DokployTemplate[]> {
  return request<DokployTemplate[]>("compose.templates");
}

/**
 * Provision a catalog template into an environment. Dokploy's
 * `compose.deployTemplate` creates a compose stack from the template's bundled
 * docker-compose + generated env (and any mounts/domains) but does not start
 * it, so callers deploy the returned compose id separately. Returns the new
 * compose service id.
 */
export async function deployTemplate(
  templateId: string,
  environmentId: string
): Promise<string> {
  const created = await request<{ composeId: string }>("compose.deployTemplate", {
    method: "POST",
    body: { id: templateId, environmentId },
  });
  return created.composeId;
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

/**
 * The set of Swarm `appName`s the CURRENT user's Dokploy workspace manages.
 * The logs/metrics routes validate the requested `?app=` against this before
 * attaching to a container, so an authed user can't tail arbitrary host
 * containers by name. Uses the per-user session (via `request()`).
 */
export async function knownAppNames(): Promise<Set<string>> {
  const { services } = await loadWorkspace();
  return new Set(services.map((s) => s.appName).filter((n): n is string => Boolean(n)));
}

// ============================================================================
// Notifications (added for observability alerts — see lib/collector.ts).
//
// Switchyard does not stand up its own notification infra: it reuses whatever
// channel the operator already configured in Dokploy. `notification.all`
// returns each channel with its nested provider config (webhook URL / token),
// and we deliver an alert by POSTing to that same webhook. The `test*`
// procedures only send a fixed "Hi, From Dokploy" message, so they can't carry
// a crash-loop payload — hence the direct webhook post.
// (Confirmed against Dokploy's notification router: `notification.all` includes
//  { slack, telegram, discord, custom, mattermost, lark, teams, ... }.)
// ============================================================================

interface SlackConfig { webhookUrl: string; channel?: string | null }
interface DiscordConfig { webhookUrl: string }
interface TelegramConfig { botToken: string; chatId: string; messageThreadId?: string | null }
interface WebhookConfig { webhookUrl: string; channel?: string | null; username?: string | null }
interface CustomConfig { endpoint: string; headers?: unknown }

export interface DokployNotification {
  notificationId: string;
  name: string;
  notificationType?: string;
  slack?: SlackConfig | null;
  discord?: DiscordConfig | null;
  telegram?: TelegramConfig | null;
  mattermost?: WebhookConfig | null;
  lark?: WebhookConfig | null;
  teams?: WebhookConfig | null;
  custom?: CustomConfig | null;
}

/** All notification channels configured in Dokploy for the active org. */
export async function listNotifications(): Promise<DokployNotification[]> {
  return request<DokployNotification[]>("notification.all");
}

/** Parse Dokploy custom-webhook headers (stored as JSON string, array, or map). */
function customHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = { "Content-Type": "application/json" };
  let val = raw;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      return out;
    }
  }
  if (Array.isArray(val)) {
    for (const h of val as { name?: string; value?: string }[]) {
      if (h?.name) out[h.name] = String(h.value ?? "");
    }
  } else if (val && typeof val === "object") {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = String(v);
  }
  return out;
}

async function postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: headers ?? { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Deliver `text` to one configured channel. Returns the channel type used. */
async function deliver(n: DokployNotification, text: string): Promise<string> {
  if (n.slack?.webhookUrl) {
    await postJson(n.slack.webhookUrl, { text, channel: n.slack.channel ?? undefined });
    return "slack";
  }
  if (n.discord?.webhookUrl) {
    await postJson(n.discord.webhookUrl, { content: text });
    return "discord";
  }
  if (n.telegram?.botToken && n.telegram.chatId) {
    await postJson(`https://api.telegram.org/bot${n.telegram.botToken}/sendMessage`, {
      chat_id: n.telegram.chatId,
      text,
      message_thread_id: n.telegram.messageThreadId ?? undefined,
    });
    return "telegram";
  }
  if (n.mattermost?.webhookUrl) {
    await postJson(n.mattermost.webhookUrl, {
      text,
      channel: n.mattermost.channel ?? undefined,
      username: n.mattermost.username ?? undefined,
    });
    return "mattermost";
  }
  if (n.lark?.webhookUrl) {
    await postJson(n.lark.webhookUrl, { msg_type: "text", content: { text } });
    return "lark";
  }
  if (n.teams?.webhookUrl) {
    await postJson(n.teams.webhookUrl, { text });
    return "teams";
  }
  if (n.custom?.endpoint) {
    await postJson(n.custom.endpoint, { title: "Switchyard alert", message: text, text }, customHeaders(n.custom.headers));
    return "custom";
  }
  throw new Error(`notification "${n.name}" has no webhook-deliverable channel`);
}

export type NotifyResult =
  | { sent: true; channel: string; name: string }
  | { sent: false; reason: string };

/**
 * Send `text` through a Dokploy-configured channel. `selector` (name or id)
 * picks a specific channel; otherwise the first webhook-deliverable one is used.
 */
export async function notifyThroughDokploy(text: string, selector?: string): Promise<NotifyResult> {
  let all: DokployNotification[];
  try {
    all = await listNotifications();
  } catch (e) {
    return { sent: false, reason: `could not list Dokploy notifications: ${e instanceof Error ? e.message : e}` };
  }
  if (all.length === 0) return { sent: false, reason: "no Dokploy notification channels configured" };

  const wanted = selector?.trim().toLowerCase();
  const ordered = wanted
    ? all.filter((n) => n.name.toLowerCase() === wanted || n.notificationId === selector)
    : all;
  if (ordered.length === 0) return { sent: false, reason: `no Dokploy channel matches "${selector}"` };

  let lastErr = "";
  for (const n of ordered) {
    try {
      const channel = await deliver(n, text);
      return { sent: true, channel, name: n.name };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { sent: false, reason: lastErr || "delivery failed" };
}
