export interface ImageReference {
  registry: string;
  repository: string;
  tag: string | null;
  digest: string | null;
  normalized: string;
}

const repositoryPart = /^[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*$/;
const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const digestPattern = /^sha256:[a-fA-F0-9]{64}$/;

/** Parse a Docker image name without confusing a registry port with a tag. */
export function parseImageReference(input: string): ImageReference | null {
  const value = input.trim();
  if (!value || value.length > 1024 || /[\s\\?#]/.test(value) || value.includes("://")) return null;

  const parts = value.split("@");
  if (parts.length > 2 || (parts.length === 2 && !digestPattern.test(parts[1]))) return null;
  const digest = parts[1]?.toLowerCase() ?? null;
  let name = parts[0];
  let tag: string | null = null;
  const lastColon = name.lastIndexOf(":");
  if (lastColon > name.lastIndexOf("/")) {
    tag = name.slice(lastColon + 1);
    name = name.slice(0, lastColon);
    if (!tagPattern.test(tag)) return null;
  }

  let registry = "docker.io";
  let repository = name;
  const slash = name.indexOf("/");
  const first = name.slice(0, slash);
  if (slash !== -1 && (/[.:]/.test(first) || first.toLowerCase() === "localhost")) {
    registry = first.toLowerCase();
    repository = name.slice(slash + 1);
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\])(?::[0-9]{1,5})?$/.test(registry)) return null;
  const port = registry.match(/:(\d+)$/);
  if (port && (Number(port[1]) === 0 || Number(port[1]) > 65535)) return null;
  if (["index.docker.io", "registry-1.docker.io"].includes(registry)) registry = "docker.io";
  if (!repository || repository.length > 255 || !repository.split("/").every((part) => repositoryPart.test(part))) return null;
  if (registry === "docker.io" && !repository.includes("/")) repository = `library/${repository}`;
  if (!tag && !digest) tag = "latest";

  return {
    registry,
    repository,
    tag,
    digest,
    normalized: `${registry}/${repository}${tag ? `:${tag}` : ""}${digest ? `@${digest}` : ""}`,
  };
}

// Tag picker helpers preserve the entered prefix and distinguish an omitted tag.
export interface ImageRef {
  registry: string;
  namespace: string;
  repository: string;
  tag: string | null;
  digest: string | null;
  name: string;
}

export interface ImageTag {
  name: string;
  lastPushed: string | null;
}

const TAG = /^[\w][\w.-]{0,127}$/;
const PATH_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const DIGEST = /^[A-Za-z][A-Za-z0-9]*(?:[+._-][A-Za-z][A-Za-z0-9]*)*:[A-Fa-f0-9]{32,}$/;
const REGISTRY = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::([0-9]+))?$/i;
const DOCKER_HUB_HOSTS = new Set([
  "docker.io",
  "index.docker.io",
  "registry-1.docker.io",
  "hub.docker.com",
]);

/** Parse image names, never URLs. Registry allowlisting belongs to the caller. */
export function parseImageRef(input: string): ImageRef | null {
  if (!input || input.length > 1024 || /\s|[\\?#]/.test(input)) return null;

  const parts = input.split("@");
  if (parts.length > 2) return null;
  const digest = parts[1] ?? null;
  if (digest !== null && !DIGEST.test(digest)) return null;

  let name = parts[0];
  let tag: string | null = null;
  const colon = name.lastIndexOf(":");
  if (colon > name.lastIndexOf("/")) {
    tag = name.slice(colon + 1);
    name = name.slice(0, colon);
    if (!TAG.test(tag)) return null;
  }
  if (!name || name.length > 255) return null;

  const path = name.split("/");
  const first = path[0];
  let registry = "registry-1.docker.io";
  if (path.length > 1 && (/[.:]/.test(first) || first === "localhost" || first.toLowerCase() !== first)) {
    const match = first.match(REGISTRY);
    if (!match || (match[1] && (Number(match[1]) < 1 || Number(match[1]) > 65535))) return null;
    registry = first.toLowerCase();
    path.shift();
    if (DOCKER_HUB_HOSTS.has(registry)) registry = "registry-1.docker.io";
  }
  if (!path.every((component) => PATH_COMPONENT.test(component))) return null;

  const repository = path.pop()!;
  const namespace = path.join("/") || (registry === "registry-1.docker.io" ? "library" : "");
  return { registry, namespace, repository, tag, digest, name };
}

/** Keep the entered repository prefix and remove any digest when choosing a tag. */
export function withImageTag(input: string, tag: string): string | null {
  const ref = parseImageRef(input);
  return ref && !/\s/.test(tag) && TAG.test(tag) ? `${ref.name}:${tag}` : null;
}

function pushedTime(tag: ImageTag): number {
  const value = tag.lastPushed === null ? NaN : Date.parse(tag.lastPushed);
  return Number.isFinite(value) ? value : -Infinity;
}

/** Newest first; unknown dates last, with reproducible tag-name tie breaking. */
export function sortImageTags(tags: ImageTag[]): ImageTag[] {
  return [...tags].sort((a, b) => {
    const aTime = pushedTime(a);
    const bTime = pushedTime(b);
    if (aTime !== bTime) return aTime > bTime ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

export function filterImageTags(tags: ImageTag[], query: string): ImageTag[] {
  const search = query.trim().toLowerCase();
  return sortImageTags(tags.filter((tag) => tag.name.toLowerCase().includes(search)));
}
