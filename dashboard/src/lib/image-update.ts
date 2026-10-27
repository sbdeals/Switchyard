import { parseImageReference } from "./image-ref";

export type ImageServiceKind = "application" | "database" | "compose";

export interface RunningServiceImage {
  image: string;
  repoDigests: string[];
  serviceName?: string;
}

export interface ImageUpdateResult {
  image: string;
  runningDigest: string | null;
  registryDigest: string | null;
  status: "up-to-date" | "update-available" | "unknown";
  reason: string | null;
  checkedAt: string | null;
  serviceName?: string;
}

interface ProjectTree {
  environments?: {
    applications?: { applicationId: string }[];
    compose?: { composeId: string }[];
    postgres?: { postgresId: string }[];
    mysql?: { mysqlId: string }[];
    mariadb?: { mariadbId: string }[];
    mongo?: { mongoId: string }[];
    redis?: { redisId: string }[];
  }[];
}

interface ImageServiceDetail {
  appName?: string;
  sourceType?: string | null;
  dockerImage?: string | null;
}

export interface ImageUpdateDependencies {
  request: <T>(path: string) => Promise<T>;
  inspect: (appName: string, kind: ImageServiceKind) => Promise<RunningServiceImage[]>;
  lookup: (reference: string) => Promise<{
    digest: string | null;
    reason: string | null;
    checkedAt: string | null;
  }>;
}

/** Find the service in this user's project tree before reading its details. */
function detailPath(tree: ProjectTree[], kind: ImageServiceKind, id: string): string | null {
  for (const project of tree) {
    for (const env of project.environments ?? []) {
      if (kind === "application" && env.applications?.some((app) => app.applicationId === id)) {
        return `application.one?applicationId=${encodeURIComponent(id)}`;
      }
      if (kind === "compose" && env.compose?.some((compose) => compose.composeId === id)) {
        return `compose.one?composeId=${encodeURIComponent(id)}`;
      }
      if (kind === "database") {
        for (const engine of ["postgres", "mysql", "mariadb", "mongo", "redis"] as const) {
          const services = env[engine] as Record<string, string>[] | undefined;
          if (services?.some((service) => service[`${engine}Id`] === id)) {
            return `${engine}.one?${engine}Id=${encodeURIComponent(id)}`;
          }
        }
      }
    }
  }
  return null;
}

/** RepoDigests identify registry manifests/indexes; Docker's image ID does not. */
export function matchingRepoDigests(image: string, repoDigests: string[]): string[] {
  const reference = parseImageReference(image);
  if (!reference) return [];
  return [...new Set(repoDigests.flatMap((value) => {
    const candidate = parseImageReference(value);
    return candidate?.digest && candidate.registry === reference.registry &&
      candidate.repository === reference.repository ? [candidate.digest] : [];
  }))];
}

async function checkImage(
  image: string,
  containers: RunningServiceImage[],
  inspectFailed: boolean,
  lookup: ImageUpdateDependencies["lookup"],
  serviceName?: string,
): Promise<ImageUpdateResult> {
  const reference = parseImageReference(image);
  const digestSets = containers.map((container) => matchingRepoDigests(image, container.repoDigests));
  const sharedDigests = digestSets[0]?.filter((digest) => digestSets.every((set) => set.includes(digest))) ?? [];
  const result: ImageUpdateResult = {
    image,
    runningDigest: sharedDigests[0] ?? null,
    registryDigest: null,
    status: "unknown",
    reason: null,
    checkedAt: null,
    ...(serviceName ? { serviceName } : {}),
  };
  if (!reference) return { ...result, reason: image ? "The configured image reference is invalid." : "No Docker image is configured." };

  const registry = await lookup(image);
  result.registryDigest = registry.digest;
  result.checkedAt = registry.checkedAt;
  if (!registry.digest) return { ...result, reason: registry.reason ?? "Registry digest is unavailable." };
  if (inspectFailed) return { ...result, reason: "The running image could not be inspected." };
  if (containers.length === 0) return { ...result, reason: "No running container was found." };
  if (digestSets.some((set) => set.length === 0)) {
    return { ...result, reason: "The running image has no matching registry digest." };
  }
  if (sharedDigests.includes(registry.digest)) {
    return { ...result, runningDigest: registry.digest, status: "up-to-date" };
  }
  if (sharedDigests.length === 0) {
    return { ...result, reason: "Running replicas use different image digests." };
  }
  return { ...result, status: "update-available" };
}

/** A manual, read-only check. A missing service fails closed before Docker/registry access. */
export async function checkServiceImageUpdates(
  kind: ImageServiceKind,
  id: string,
  dependencies: ImageUpdateDependencies,
): Promise<{ images: ImageUpdateResult[] } | null> {
  const tree = await dependencies.request<ProjectTree[]>("project.all");
  const path = detailPath(tree, kind, id);
  if (!path) return null;
  const detail = await dependencies.request<ImageServiceDetail>(path);
  if (kind === "application" && detail.sourceType !== "docker") return { images: [] };

  let containers: RunningServiceImage[] = [];
  let inspectFailed = false;
  if (detail.appName) {
    try {
      containers = await dependencies.inspect(detail.appName, kind);
    } catch {
      inspectFailed = true;
    }
  }
  if (kind !== "compose") {
    return { images: [await checkImage(detail.dockerImage ?? "", containers, inspectFailed, dependencies.lookup)] };
  }
  if (inspectFailed) throw new Error("The compose images could not be inspected.");

  // Compose's resolved Config.Image includes variable expansion and the deployed
  // reference; group replicas without parsing or returning the compose file/env.
  const groups = new Map<string, RunningServiceImage[]>();
  for (const container of containers) {
    const key = JSON.stringify([container.serviceName, container.image]);
    const group = groups.get(key) ?? [];
    group.push(container);
    groups.set(key, group);
  }
  return {
    images: await Promise.all([...groups.values()].map((group) =>
      checkImage(group[0].image, group, inspectFailed, dependencies.lookup, group[0].serviceName),
    )),
  };
}
