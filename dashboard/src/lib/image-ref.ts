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
