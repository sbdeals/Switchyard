import { describe, expect, it } from "vitest";
import { imageStack, parseManaged, repoStack, validateRepoSource } from "./managed-compose";
import { DEPLOY_SAMPLES, quickDeployOptions } from "./quick-deploy";

describe("quickDeployOptions", () => {
  it("keeps GitHub App deploys out of bridge onboarding and explains public Git requirements", () => {
    expect(quickDeployOptions("bridge")).toEqual({
      github: false,
      repoHint: "Public repos with a Dockerfile. GitHub App / private repos need Swarm.",
    });
  });

  it("allows GitHub App deploys on Swarm without the bridge-only warning", () => {
    expect(quickDeployOptions("swarm")).toEqual({
      github: true,
      repoHint: "Deploy from a public Git repository.",
    });
  });
});

describe("DEPLOY_SAMPLES", () => {
  it("provides a public Git sample accepted by the existing bridge deploy validation", () => {
    const source = { repoUrl: DEPLOY_SAMPLES.repo.url, branch: DEPLOY_SAMPLES.repo.branch };
    expect(() => validateRepoSource(source)).not.toThrow();
    const compose = repoStack({ appName: "welcome-sample", ...source });
    expect(parseManaged(compose)).toMatchObject({
      kind: "repo", repoUrl: "https://github.com/docker/welcome-to-docker", branch: "main",
    });
    expect(compose).toContain('context: "https://github.com/docker/welcome-to-docker.git#main"');
  });

  it("provides an image sample that round-trips through the existing managed stack", () => {
    const compose = imageStack({ appName: "whoami-sample", image: DEPLOY_SAMPLES.image });
    expect(parseManaged(compose)).toEqual({ kind: "image", image: "traefik/whoami" });
    expect(compose).toContain("    image: traefik/whoami\n");
  });
});
