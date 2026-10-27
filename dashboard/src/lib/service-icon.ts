import type { Service } from "@/lib/dokploy";

export type ServiceIconKind =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "mongo"
  | "redis"
  | "nginx"
  | "node"
  | "python"
  | "traefik"
  | "whoami"
  | "github"
  | "compose"
  | "database"
  | "application";

const IMAGE_ICONS = new Map<string, ServiceIconKind>([
  ["postgres", "postgres"],
  ["postgresql", "postgres"],
  ["mysql", "mysql"],
  ["mariadb", "mariadb"],
  ["mongo", "mongo"],
  ["mongodb", "mongo"],
  ["redis", "redis"],
  ["nginx", "nginx"],
  ["node", "node"],
  ["nodejs", "node"],
  ["python", "python"],
  ["traefik", "traefik"],
  ["whoami", "whoami"],
]);

/** Extract the image name without confusing a registry port with an image tag. */
export function dockerImageBasename(image: string | null | undefined): string | null {
  const reference = image?.trim().toLowerCase();
  if (!reference || /\s|:\/\//.test(reference)) return null;

  const [repository, digest, ...extra] = reference.split("@");
  if (extra.length || (digest !== undefined && !/^[a-z][a-z0-9_+.-]*:[a-z0-9=_-]+$/.test(digest))) {
    return null;
  }

  const parts = repository.split("/");
  if (parts.some((part) => !part)) return null;
  const leaf = parts[parts.length - 1];
  const match = /^([a-z0-9]+(?:[._-]+[a-z0-9]+)*)(?::[a-z0-9_][a-z0-9_.-]*)?$/.exec(leaf);
  return match?.[1] ?? null;
}

function isGitHubRepository(repository: string | null | undefined): boolean {
  const reference = repository?.trim();
  if (!reference) return false;
  if (/^git@github\.com:[^/\s]+\/[^/\s]+\/?$/i.test(reference)) return true;
  try {
    const url = new URL(reference);
    return ["https:", "http:", "ssh:", "git:"].includes(url.protocol)
      && url.hostname.toLowerCase() === "github.com"
      && /^\/[^/]+\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Native service kinds and an explicit Git source win over stale Docker fields. */
export function resolveServiceIcon(service: Service): ServiceIconKind {
  if (service.kind === "database") {
    switch (service.engine) {
      case "postgres":
      case "mysql":
      case "mariadb":
      case "mongo":
      case "redis":
        return service.engine;
      default:
        return "database";
    }
  }
  if (service.kind === "compose") return "compose";
  if (service.sourceType === "github" || (
    service.sourceType === "git" && isGitHubRepository(service.gitUrl?.trim() || service.repository)
  )) return "github";
  if (service.sourceType !== "docker" && service.sourceType !== null) return "application";

  const image = dockerImageBasename(service.dockerImage);
  return (image && IMAGE_ICONS.get(image)) || "application";
}
