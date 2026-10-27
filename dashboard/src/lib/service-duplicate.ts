import type { Engine } from "./dokploy";

// js-yaml is already in the dashboard's lockfile (via ESLint); keep this typed
// boundary local because its optional @types package is not installed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require("js-yaml") as {
  load: (text: string) => unknown;
  dump: (value: unknown, options: { noRefs: boolean; lineWidth: number }) => string;
};

export type DuplicateServiceRef =
  | { kind: "application"; id: string }
  | { kind: "compose"; id: string }
  | { kind: "database"; id: string; engine: Engine };

type Raw = Record<string, unknown>;

export interface DuplicatePlan {
  create: Raw;
  update: Raw;
  environment?: { env: string; createEnvFile?: boolean; buildArgs?: string; buildSecrets?: string };
  ports: {
    publishedPort: number;
    targetPort: number;
    protocol: "tcp" | "udp";
    publishMode: "ingress" | "host";
  }[];
  mounts: { type: "volume"; mountPath: string; volumeName: string }[];
}

export function duplicateServiceNameError(name: string, existingNames: readonly string[] = []): string | null {
  const trimmed = name.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(trimmed)) {
    return "Use 1–63 lowercase letters, numbers, or hyphens, starting and ending with a letter or number.";
  }
  if (existingNames.some((existing) => existing.trim().toLowerCase() === trimmed)) {
    return "A service with this name already exists in the target environment.";
  }
  return null;
}

// Allowlisted against Dokploy v0.30.10 packages/server/src/db/schema/{application,
// compose,postgres,mysql,mariadb,mongo,redis,port,mount}.ts. Never spread a source
// service: it also contains IDs, domains, refresh tokens and deployment history.
const RESOURCES = ["memoryReservation", "memoryLimit", "cpuReservation", "cpuLimit", "replicas"];
const APPLICATION_FIELDS = [
  "sourceType", "repository", "owner", "branch", "buildPath", "triggerType", "githubId",
  "gitlabProjectId", "gitlabRepository", "gitlabOwner", "gitlabBranch", "gitlabBuildPath", "gitlabPathNamespace", "gitlabId",
  "giteaRepository", "giteaOwner", "giteaBranch", "giteaBuildPath", "giteaId",
  "bitbucketRepository", "bitbucketRepositorySlug", "bitbucketOwner", "bitbucketBranch", "bitbucketBuildPath", "bitbucketId",
  "customGitUrl", "customGitBranch", "customGitBuildPath", "customGitSSHKeyId",
  "dockerImage", "username", "password", "registryUrl", "registryId",
  "enableSubmodules", "watchPaths", "buildType", "dockerfile", "dockerContextPath", "dockerBuildStage",
  "buildArgs", "buildSecrets", "buildServerId", "buildRegistryId", "railpackVersion", "herokuVersion", "publishDirectory", "isStaticSpa",
  "createEnvFile", "command", "args", "healthCheckSwarm", "restartPolicySwarm", "stopGracePeriodSwarm", "ulimitsSwarm",
  ...RESOURCES,
];

function isObject(value: unknown): value is Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pick(source: Raw, fields: readonly string[]): Raw {
  return Object.fromEntries(fields.filter((key) => source[key] !== undefined && source[key] !== null).map((key) => [key, source[key]]));
}

function volumeNames(name: string, suffix: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(suffix)) throw new Error("A unique volume suffix is required.");
  const names = new Map<string, string>();
  return (source: string) => {
    let volume = names.get(source);
    if (!volume) {
      volume = `${name.slice(0, 32)}-${suffix.toLowerCase()}-${names.size + 1}`;
      names.set(source, volume);
    }
    return volume;
  };
}

/** Split short volume syntax without splitting colons in ${VAR:-default}. */
function volumeParts(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let braces = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "{") braces++;
    else if (value[i] === "}") braces--;
    else if (value[i] === ":" && braces === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function duplicateComposeFile(text: string, freshVolume: (source: string) => string): string {
  let loaded: unknown;
  try {
    // Round-tripping also rejects cyclic YAML aliases and removes shared object
    // references before rewriting service definitions produced by YAML merges.
    loaded = JSON.parse(JSON.stringify(yaml.load(text)));
  } catch {
    throw new Error("The source compose file must contain valid, non-cyclic YAML.");
  }
  if (!isObject(loaded) || !isObject(loaded.services) || !Object.keys(loaded.services).length) {
    throw new Error("The source compose file must contain services.");
  }
  if (loaded.include !== undefined) {
    throw new Error("Flatten compose includes before duplicating this service.");
  }
  delete loaded.name;
  const declarations: Raw = {};
  const volume = (source: string) => {
    const renamed = freshVolume(`compose:${source}`);
    declarations[renamed] = { name: renamed };
    return renamed;
  };
  if (isObject(loaded.volumes)) {
    for (const key of Object.keys(loaded.volumes)) volume(key);
  }
  for (const [serviceName, entry] of Object.entries(loaded.services)) {
    if (!isObject(entry)) throw new Error("The source compose file contains an invalid service.");
    if (entry.extends !== undefined || entry.volumes_from !== undefined) {
      throw new Error("Flatten compose extends and volumes_from before duplicating this service.");
    }
    delete entry.container_name;
    // Routing labels are domain configuration too, including labels in Swarm's
    // deploy block. Removing labels avoids activating the source's public host.
    delete entry.labels;
    delete entry.label_file;
    if (isObject(entry.deploy)) delete entry.deploy.labels;
    if (entry.volumes !== undefined && !Array.isArray(entry.volumes)) {
      throw new Error("The source compose file contains invalid volumes.");
    }
    if (Array.isArray(entry.volumes)) {
      entry.volumes = entry.volumes.map((mount, index) => {
        let source: string;
        let target: unknown;
        let readOnly = false;
        if (typeof mount === "string") {
          const parts = volumeParts(mount);
          if (parts.length > 3) throw new Error("Unsupported compose volume syntax.");
          source = parts.length === 1 ? `anonymous:${serviceName}:${index}` : parts[0];
          target = parts.length === 1 ? parts[0] : parts[1];
          readOnly = parts[2]?.split(",").includes("ro") ?? false;
        } else if (isObject(mount)) {
          if (mount.type === "tmpfs") return mount;
          if (mount.type !== "volume" && mount.type !== "bind") throw new Error("Unsupported compose mount type.");
          source = typeof mount.source === "string" ? mount.source : `anonymous:${serviceName}:${index}`;
          target = mount.target;
          readOnly = mount.read_only === true;
        } else {
          throw new Error("Unsupported compose volume syntax.");
        }
        if (typeof target !== "string" || !target.startsWith("/")) {
          throw new Error("Compose volume targets must be absolute container paths.");
        }
        return { type: "volume", source: volume(source), target, ...(readOnly ? { read_only: true } : {}) };
      });
    }
  }
  // Discard external/driver_opts/name declarations that could reconnect data.
  if (Object.keys(declarations).length) loaded.volumes = declarations;
  else delete loaded.volumes;
  return yaml.dump(loaded, { noRefs: true, lineWidth: -1 });
}

export function buildDuplicatePlan(input: {
  source: Raw;
  ref: DuplicateServiceRef;
  name: string;
  environmentId: string;
  existingNames: readonly string[];
  suffix: string;
  mounts?: readonly Raw[];
}): DuplicatePlan {
  const { source, ref, environmentId } = input;
  const name = input.name.trim();
  const error = duplicateServiceNameError(name, input.existingNames);
  if (error) throw new Error(error);
  const freshVolume = volumeNames(name, input.suffix);
  const plan: DuplicatePlan = {
    create: { ...pick(source, ["description", "serverId"]), name, environmentId },
    update: {},
    ports: [],
    mounts: [],
  };
  if (typeof source.env === "string") {
    plan.environment = { env: source.env };
    if (ref.kind !== "database" && typeof source.createEnvFile === "boolean") {
      plan.environment.createEnvFile = source.createEnvFile;
    }
  }
  if (ref.kind === "application") {
    if (plan.environment) {
      plan.environment.buildArgs = typeof source.buildArgs === "string" ? source.buildArgs : "";
      plan.environment.buildSecrets = typeof source.buildSecrets === "string" ? source.buildSecrets : "";
      plan.environment.createEnvFile = source.createEnvFile !== false;
    }
    if (source.sourceType === "drop") throw new Error("Uploaded source files cannot be duplicated. Use a repository or Docker image first.");
    Object.assign(plan.create, pick(source, ["sourceType"]));
    plan.update = { ...pick(source, APPLICATION_FIELDS), autoDeploy: false, applicationStatus: "idle", isPreviewDeploymentsActive: false };
    if (Array.isArray(source.ports)) {
      plan.ports = source.ports.map((port) => {
        if (!isObject(port) || typeof port.publishedPort !== "number" || typeof port.targetPort !== "number") {
          throw new Error("The source application contains an invalid port mapping.");
        }
        return {
          publishedPort: port.publishedPort,
          targetPort: port.targetPort,
          protocol: port.protocol === "udp" ? "udp" : "tcp",
          publishMode: port.publishMode === "ingress" ? "ingress" : "host",
        };
      });
    }
  } else if (ref.kind === "compose") {
    if (typeof source.composeFile !== "string" || !source.composeFile.trim()) {
      throw new Error("Save the source compose file before duplicating this service.");
    }
    const composeFile = duplicateComposeFile(source.composeFile, freshVolume);
    Object.assign(plan.create, pick(source, ["composeType"]), { sourceType: "raw" });
    // A raw snapshot ensures a later git fetch cannot restore shared volumes or
    // routing labels from the original repository.
    plan.update = { ...pick(source, ["composeType", "createEnvFile"]), sourceType: "raw", composeFile, autoDeploy: false, composeStatus: "idle" };
  } else {
    const credentials = ["dockerImage", "databasePassword"];
    if (ref.engine !== "redis") credentials.push("databaseUser");
    if (ref.engine === "postgres" || ref.engine === "mysql" || ref.engine === "mariadb") credentials.push("databaseName");
    if (ref.engine === "mysql" || ref.engine === "mariadb") credentials.push("databaseRootPassword");
    if (ref.engine === "mongo") credentials.push("replicaSets");
    Object.assign(plan.create, pick(source, credentials));
    plan.update = { ...pick(source, ["command", "args", "externalPort", ...RESOURCES]), applicationStatus: "idle" };
  }
  const mounts = input.mounts ?? (Array.isArray(source.mounts) ? source.mounts : []);
  plan.mounts = mounts.map((mount, index) => {
    if (!isObject(mount) || typeof mount.mountPath !== "string" || !mount.mountPath.startsWith("/")) {
      throw new Error("The source contains an invalid mount path.");
    }
    const original = mount.volumeName ?? mount.hostPath ?? `mount:${index}`;
    return { type: "volume", mountPath: mount.mountPath, volumeName: freshVolume(`mount:${original}`) };
  });
  return plan;
}
