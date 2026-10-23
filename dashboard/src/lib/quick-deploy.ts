import type { DeployTarget } from "./deploy-target";

export const DEPLOY_SAMPLES = {
  repo: { url: "https://github.com/docker/welcome-to-docker", branch: "main" },
  image: "traefik/whoami",
} as const;

export function quickDeployOptions(target: DeployTarget) {
  return {
    github: target === "swarm",
    repoHint: target === "bridge"
      ? "Public repos with a Dockerfile. GitHub App / private repos need Swarm."
      : "Deploy from a public Git repository.",
  };
}
