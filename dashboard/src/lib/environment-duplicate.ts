/** Pure, allowlisted copy planning. Raw plans stay on the server. */
export type DuplicateServiceType =
  | "application" | "compose" | "postgres" | "mysql" | "mariadb" | "mongo" | "redis";

export interface DuplicateOptions {
  projectId: string;
  sourceEnvironmentId: string;
  name: string;
  copyVariables?: boolean;
  deploy?: boolean;
}

export interface RawDuplicateService {
  type: DuplicateServiceType;
  id: string;
  detail: Record<string, unknown>;
  mounts?: Record<string, unknown>[];
}

export interface DuplicateServicePlan {
  sourceId: string;
  type: DuplicateServiceType;
  name: string;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
  env?: string;
  environment?: Record<string, unknown>;
  ports: Record<string, unknown>[];
  mounts: Record<string, unknown>[];
  warnings: string[];
  domainsNotCopied: string[];
}

export interface DuplicatePlan {
  options: Required<DuplicateOptions>;
  environment?: { env: string };
  services: DuplicateServicePlan[];
  warnings: string[];
  domainsNotCopied: string[];
}

export interface DuplicateSummary {
  options: Required<DuplicateOptions>;
  environmentVariableCount: number;
  services: {
    sourceId: string;
    type: DuplicateServiceType;
    name: string;
    variableCount: number;
    portCount: number;
    mountCount: number;
    warnings: string[];
    domainsNotCopied: string[];
  }[];
  warnings: string[];
  domainsNotCopied: string[];
}

export class DuplicateValidationError extends Error {}

const SOURCE_FIELDS = [
  "sourceType", "repository", "owner", "branch", "buildPath", "githubId",
  "gitlabProjectId", "gitlabRepository", "gitlabOwner", "gitlabBranch",
  "gitlabBuildPath", "gitlabPathNamespace", "gitlabId",
  "bitbucketRepository", "bitbucketRepositorySlug", "bitbucketOwner",
  "bitbucketBranch", "bitbucketBuildPath", "bitbucketId",
  "giteaRepository", "giteaOwner", "giteaBranch", "giteaBuildPath", "giteaId",
  "customGitUrl", "customGitBranch", "customGitBuildPath", "customGitSSHKeyId",
  "enableSubmodules", "watchPaths", "triggerType",
];
const RESOURCE_FIELDS = [
  "cpuLimit", "memoryLimit", "cpuReservation", "memoryReservation", "replicas",
  "healthCheckSwarm", "restartPolicySwarm", "placementSwarm", "updateConfigSwarm",
  "rollbackConfigSwarm", "modeSwarm", "stopGracePeriodSwarm", "ulimitsSwarm", "labelsSwarm", "endpointSpecSwarm",
];
const APPLICATION_FIELDS = [
  ...SOURCE_FIELDS, ...RESOURCE_FIELDS, "description", "dockerImage", "username",
  "password", "registryUrl", "buildType", "dockerfile", "dockerContextPath",
  "dockerBuildStage", "railpackVersion", "herokuVersion", "publishDirectory",
  "isStaticSpa", "command", "args", "createEnvFile", "registryId", "buildServerId", "buildRegistryId",
];
const COMPOSE_FIELDS = [
  ...SOURCE_FIELDS, "description", "composeFile", "composeType", "composePath",
  "command", "createEnvFile", "randomize", "suffix", "isolatedDeployment", "isolatedDeploymentsVolume",
];
const DATABASE_FIELDS = [
  ...RESOURCE_FIELDS, "description", "dockerImage", "command", "args", "externalPort",
  "databaseName", "databaseUser", "databasePassword", "databaseRootPassword", "replicaSets",
];

function pick(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  return Object.fromEntries(fields
    // Dokploy's optional update fields often accept undefined but reject null.
    .filter((key) => source[key] != null)
    .map((key) => [key, structuredClone(source[key])]));
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

function fail(message: string): never {
  throw new DuplicateValidationError(message);
}

/** Unknown proxy rules cannot safely be rewritten without changing user YAML. */
function hasDomainRoutes(value: unknown): boolean {
  return /traefik\.(?:http|tcp|udp)\.routers\.|traefik\.frontend\.rule|\bcaddy(?:\.[\w.-]+)?["']?\s*[:=]/i
    .test(typeof value === "string" ? value : JSON.stringify(value ?? ""));
}

function planService(raw: RawDuplicateService, options: Required<DuplicateOptions>): DuplicateServicePlan {
  const { detail, type } = raw;
  const name = typeof detail.name === "string" ? detail.name : "";
  if (!name.trim()) fail("Every source service must have a name.");
  if (!raw.id) fail(`The source service ${name} is missing its ID.`);
  if (detail.environmentId != null && detail.environmentId !== options.sourceEnvironmentId) {
    fail(`The service ${name} does not belong to the source environment.`);
  }
  const warnings: string[] = [];
  if (hasDomainRoutes(detail.labelsSwarm)) fail(`${name}: remove embedded proxy domain routes before duplicating.`);
  const domainsNotCopied = records(detail.domains)
    .map((domain) => domain.host)
    .filter((host): host is string => typeof host === "string");
  const create = { name, ...pick(detail, ["description", "serverId"]) };
  let update: Record<string, unknown>;
  if (type === "application" || type === "compose") {
    if (detail.sourceType === "drop") fail(`${name}: uploaded source files cannot be duplicated; use a repository or image source.`);
    update = { ...pick(detail, type === "application" ? APPLICATION_FIELDS : COMPOSE_FIELDS), autoDeploy: false };
  } else if (["postgres", "mysql", "mariadb", "mongo", "redis"].includes(type)) {
    Object.assign(create, pick(detail, ["dockerImage", "databaseName", "databaseUser", "databasePassword", "databaseRootPassword", "replicaSets"]));
    if (typeof detail.databasePassword !== "string") fail(`${name}: database login settings could not be read.`);
    if (type !== "redis" && typeof detail.databaseUser !== "string") fail(`${name}: database login settings could not be read.`);
    if (type !== "redis" && type !== "mongo" && typeof detail.databaseName !== "string") fail(`${name}: database name could not be read.`);
    update = pick(detail, DATABASE_FIELDS);
    warnings.push("Database login settings are copied; stored data is not.");
  } else {
    fail(`${name}: this service type cannot be duplicated.`);
  }

  let sharedStorage = false;
  if (type === "compose") {
    const compose = typeof detail.composeFile === "string" ? detail.composeFile : "";
    if (hasDomainRoutes(compose)) fail(`${name}: remove embedded proxy domain routes from the Compose file before duplicating.`);
    if (/^["']?name["']?\s*:/m.test(compose) || /\bcontainer_name["']?\s*:/m.test(compose)) {
      warnings.push("Explicit Compose project/container names are preserved and can collide; review them before deploying.");
      sharedStorage = true;
    }
    // Default Compose volume names use the new stack name; explicit names,
    // external volumes and bind mounts can still point to existing data.
    if (/\bexternal["']?\s*:\s*(?:["']?true|\{)|\bname["']?\s*:|(?:^|[\s"'])[.~/][^\n]*:\//m.test(compose)
      || /\btype["']?\s*:\s*["']?bind\b/m.test(compose)) {
      warnings.push("Compose external/named volumes or host binds may share existing data. Definitions are copied; data is not. Review before deploying.");
      sharedStorage = true;
    }
    if (/\b(?:environment|env_file|args|secrets)\s*:/m.test(compose)) {
      warnings.push("Inline Compose variables, build arguments and file references stay in the Compose file. Copy variables controls saved Variables entries.");
    }
    if (detail.sourceType && detail.sourceType !== "raw") {
      warnings.push("Repository Compose files are copied by reference. Review embedded domains and storage before deploying.");
      sharedStorage = true;
    }
    if (typeof detail.command === "string" && detail.command.trim()) {
      warnings.push("The custom Compose command is preserved and may target the source stack. Review it before deploying.");
      sharedStorage = true;
    }
    if (detail.randomize === true) {
      warnings.push("The Compose randomization suffix is preserved and may collide with the source stack. Review it before deploying.");
      sharedStorage = true;
    }
  }

  const mounts = (raw.mounts ?? records(detail.mounts)).map((mount) => {
    if (!["volume", "bind", "file"].includes(String(mount.type)) || typeof mount.mountPath !== "string" || !mount.mountPath) {
      fail(`${name}: a mount definition could not be copied safely.`);
    }
    if (mount.type === "bind") {
      warnings.push("Host bind mount definitions retain their host paths and may share existing data; no data is copied.");
      sharedStorage = true;
    }
    // Keep source identity privately so shared mounts can receive the same new
    // volume name. The executor removes this metadata before calling Dokploy.
    return {
      ...pick(mount, ["type", "mountPath", "hostPath", "filePath", "content"]),
      ...(mount.type === "volume" && typeof mount.volumeName === "string" ? { sourceVolumeName: mount.volumeName } : {}),
    };
  });
  if (sharedStorage && options.deploy) {
    fail(`${name}: turn off deploy after duplicating and review shared storage, source files or explicit names before deploying.`);
  }
  const ports = type === "application"
    ? records(detail.ports).map((port) => pick(port, ["publishedPort", "targetPort", "protocol", "publishMode"]))
    : [];
  if (ports.length > 0 || detail.externalPort != null || (type === "compose" && /\bports\s*:/.test(String(detail.composeFile ?? "")))) {
    warnings.push("Published ports are preserved and can collide with the source environment on the same server.");
  }

  const env = options.copyVariables ? (typeof detail.env === "string" ? detail.env : "") : undefined;
  const environment = options.copyVariables
    ? type === "application"
      ? { env: env ?? "", buildArgs: detail.buildArgs ?? "", buildSecrets: detail.buildSecrets ?? "", createEnvFile: detail.createEnvFile ?? true }
      : { env, ...pick(detail, type === "compose" ? ["createEnvFile"] : []) }
    : undefined;
  return { sourceId: raw.id, type, name, create, update, env, environment, ports, mounts, warnings, domainsNotCopied };
}

export function planEnvironmentDuplicate(
  project: { projectId: string; name: string; environments: { environmentId: string; name: string; env?: string | null }[] },
  input: DuplicateOptions,
  rawServices: RawDuplicateService[],
): DuplicatePlan {
  if (typeof input.name !== "string") fail("Enter a name for the new environment.");
  const name = input.name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,63}$/.test(name)) {
    fail("Use 1–64 letters, numbers, spaces, dots, underscores or hyphens for the environment name.");
  }
  if (input.projectId !== project.projectId) fail("The source project does not match.");
  if (!project.environments.some((environment) => environment.environmentId === input.sourceEnvironmentId)) {
    fail("The source environment no longer exists in this project.");
  }
  if (name.toLowerCase() === "production") fail("Dokploy reserves the environment name production. Choose another name.");
  if (project.environments.some((environment) => environment.name.trim().toLowerCase() === name.toLowerCase())) {
    fail("An environment with this name already exists in the project.");
  }
  if ((input.copyVariables !== undefined && typeof input.copyVariables !== "boolean")
    || (input.deploy !== undefined && typeof input.deploy !== "boolean")) {
    fail("Copy variables and deploy after duplicating must be boolean options.");
  }
  const options = {
    projectId: input.projectId, sourceEnvironmentId: input.sourceEnvironmentId, name,
    copyVariables: input.copyVariables ?? true, deploy: input.deploy ?? false,
  };
  const names = new Set<string>();
  const ids = new Set<string>();
  const services = rawServices.map((raw) => {
    const service = planService(raw, options);
    const normalizedName = service.name.trim().toLowerCase();
    if (names.has(normalizedName)) fail(`Source services share the name ${service.name}. Give them unique names before duplicating.`);
    if (ids.has(`${service.type}:${service.sourceId}`)) fail("A source service appears more than once.");
    names.add(normalizedName);
    ids.add(`${service.type}:${service.sourceId}`);
    return service;
  });
  return {
    options, services,
    environment: options.copyVariables
      ? { env: project.environments.find((environment) => environment.environmentId === options.sourceEnvironmentId)?.env ?? "" }
      : undefined,
    warnings: [
      "Domains are not copied; add domains in the new environment.",
      "Volume data, deployment history and webhook tokens are not copied. Named volume mounts receive fresh names; automatic deploys stay off.",
      "Service names and variable values are preserved. Review any variables that point to source hostnames or IDs before deploying.",
    ],
    domainsNotCopied: [...new Set(services.flatMap((service) => service.domainsNotCopied))],
  };
}

/** Safe for client preflight: never return env values, file contents or credentials. */
export function summarizeEnvironmentDuplicate(plan: DuplicatePlan): DuplicateSummary {
  const variableCount = (env: string | undefined) => (env ?? "").split(/\r?\n/)
    .filter((line) => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)).length;
  return {
    options: { ...plan.options },
    environmentVariableCount: variableCount(plan.environment?.env),
    services: plan.services.map((service) => ({
      sourceId: service.sourceId, type: service.type, name: service.name,
      variableCount: variableCount(service.env),
      portCount: service.ports.length,
      mountCount: service.mounts.length,
      warnings: [...service.warnings], domainsNotCopied: [...service.domainsNotCopied],
    })),
    warnings: [...plan.warnings], domainsNotCopied: [...plan.domainsNotCopied],
  };
}
