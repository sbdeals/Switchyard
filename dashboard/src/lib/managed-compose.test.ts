import { describe, expect, it } from "vitest";
import { bridgeImageDomain, imageStack, parseManaged, repoStack, validateRepoSource, withImageEnvFile } from "./managed-compose";

const repoInput = { appName: "web-x1", repoUrl: "https://github.com/docker/welcome-to-docker", branch: "main" };

describe("bridgeImageDomain", () => {
  it("uses the generated traefik.me hostname over HTTP without requesting a certificate", () => {
    expect(bridgeImageDomain({
      appName: "web-x1",
      hostIp: "203.0.113.10",
      generatedHost: "web-x1-random.203.0.113.10.traefik.me",
      port: 8080,
    })).toEqual({
      host: "web-x1-random.203.0.113.10.traefik.me",
      port: 8080,
      https: false,
      certificateType: "none",
      path: "/",
    });
  });

  it("falls back to sslip.io with a certificate when no generated hostname is available", () => {
    expect(bridgeImageDomain({
      appName: "web-x1",
      hostIp: "203.0.113.10",
      generatedHost: null,
      port: 80,
    })).toEqual({
      host: "web-x1.203.0.113.10.sslip.io",
      port: 80,
      https: true,
      certificateType: "letsencrypt",
      path: "/",
    });
  });
});

describe("imageStack", () => {
  it("keeps the routable app service on the shared bridge with its variables and network alias", () => {
    const compose = imageStack({ appName: "web-x1", image: "nginx:alpine" });
    expect(parseManaged(compose)).toEqual({ kind: "image", image: "nginx:alpine" });
    expect(compose).toContain("services:\n  app:\n    image: nginx:alpine\n");
    expect(compose).toContain("    env_file:\n      - .env\n");
    expect(compose).toContain("    networks:\n      dokploy-network:\n        aliases:\n          - web-x1\n");
    expect(compose).toContain("\nnetworks:\n  dokploy-network:\n    external: true\n");
  });
});

describe("repoStack", () => {
  it("builds the branch head with the shared bridge, variables, and a local image", () => {
    const compose = repoStack(repoInput);
    expect(parseManaged(compose)).toEqual({
      kind: "repo", image: "web-x1-app:latest", repoUrl: repoInput.repoUrl, branch: "main",
    });
    expect(compose).toContain('    build:\n      context: "https://github.com/docker/welcome-to-docker.git#main"\n');
    expect(compose).toContain("    image: web-x1-app:latest\n    restart: unless-stopped\n");
    expect(compose).toContain("    env_file:\n      - .env\n");
    expect(compose).toContain("    networks:\n      dokploy-network:\n        aliases:\n          - web-x1\n");
    expect(compose).toContain("\nnetworks:\n  dokploy-network:\n    external: true\n");
    expect(compose).not.toContain("dockerfile:");
  });

  it.each([
    "https://github.com/docker/welcome-to-docker",
    "https://github.com/docker/welcome-to-docker.git",
    "https://github.com/docker/welcome-to-docker/",
    "https://github.com/docker/welcome-to-docker.git/",
    "http://github.com/docker/welcome-to-docker/",
  ])("normalizes the Git build context while preserving source metadata: %s", (repoUrl) => {
    const compose = repoStack({ ...repoInput, repoUrl });
    const protocol = repoUrl.startsWith("https:") ? "https" : "http";
    expect(compose).toContain(`      context: "${protocol}://github.com/docker/welcome-to-docker.git#main"\n`);
    expect(parseManaged(compose)).toMatchObject({ kind: "repo", repoUrl, branch: "main" });
  });

  it("preserves the subdirectory and custom Dockerfile in metadata and build config", () => {
    const compose = repoStack({ ...repoInput, branch: "release/v2", subdirectory: "packages/web", dockerfile: "docker/app.Dockerfile" });
    expect(parseManaged(compose)).toEqual({
      kind: "repo", image: "web-x1-app:latest", repoUrl: repoInput.repoUrl,
      branch: "release/v2", subdirectory: "packages/web", dockerfile: "docker/app.Dockerfile",
    });
    expect(compose).toContain('      context: "https://github.com/docker/welcome-to-docker.git#release/v2:packages/web"\n');
    expect(compose).toContain("      dockerfile: docker/app.Dockerfile\n");
    expect(repoStack({ ...repoInput, dockerfile: "Dockerfile" })).not.toContain("      dockerfile:");
  });

  it("quotes user input without introducing YAML fields and round-trips escaped metadata", () => {
    const input = {
      appName: "web\ninjected: true",
      repoUrl: "https://example.com/team/o'brien.git",
      branch: 'release/"quoted"',
      subdirectory: "packages/it's app",
      dockerfile: 'docker/"custom"\nDockerfile',
    };
    const compose = repoStack(input);
    expect(parseManaged(compose)).toEqual({ kind: "repo", image: `${input.appName}-app:latest`,
      repoUrl: input.repoUrl, branch: input.branch, subdirectory: input.subdirectory, dockerfile: input.dockerfile });
    expect(compose).toContain(`      context: ${JSON.stringify(`${input.repoUrl}#${input.branch}:${input.subdirectory}`)}\n`);
    expect(compose).toContain(`      dockerfile: ${JSON.stringify(input.dockerfile)}\n`);
    expect(compose).toContain(`          - ${JSON.stringify(input.appName)}\n`);
    expect(compose).not.toContain("\ninjected:");
  });

  it("keeps branch names and Dockerfile paths that resemble YAML literals as strings", () => {
    for (const branch of ["true", "null", "123", "yes", ".5", ".inf", "@branch"]) {
      const compose = repoStack({ ...repoInput, branch });
      expect(compose).toContain(`  branch: "${branch}"\n`);
      expect(parseManaged(compose)).toMatchObject({ kind: "repo", branch });
      expect(repoStack({ ...repoInput, dockerfile: branch })).toContain(`      dockerfile: "${branch}"\n`);
    }
  });

  it("reads single-quoted metadata after YAML re-serialization", () => {
    const compose = repoStack({ ...repoInput, subdirectory: "it's app" })
      .replace('  subdirectory: "it\'s app"', "  subdirectory: 'it''s app'");
    expect(parseManaged(compose)).toMatchObject({ kind: "repo", subdirectory: "it's app" });
  });
});

describe("validateRepoSource", () => {
  it.each(["https://github.com/team/repo.git", "http://git.example.com:8080/repo.git"])("accepts public HTTP sources: %s", (repoUrl) => {
    expect(() => validateRepoSource({ ...repoInput, repoUrl })).not.toThrow();
  });

  it.each([
    "git@github.com:team/repo.git", "ssh://git@github.com/team/repo", "file:///tmp/repo", "not-a-url",
    "https://user:secret@github.com/team/repo", "https://token@github.com/team/repo", "https://@github.com/team/repo",
    "https://github.com/team/repo extra", "https://github.com/team/repo\n", "https://github.com/team/repo#other",
  ])("rejects unsupported repository URL %s before generating compose", (repoUrl) => {
    expect(() => repoStack({ ...repoInput, repoUrl })).toThrow();
  });

  it.each(["", "main#other", "main:other", "main branch", "main\n"])("rejects invalid branch %s", (branch) => {
    expect(() => validateRepoSource({ ...repoInput, branch })).toThrow("Branch must");
  });

  it.each(["../web", "packages/../web", "packages/web..", "web:other", "web#other"])("rejects invalid subdirectory %s", (subdirectory) => {
    expect(() => validateRepoSource({ ...repoInput, subdirectory })).toThrow("Repository subdirectory must");
  });

  it.each([
    { repoUrl: "https://example.com/$REPO.git" }, { branch: "release/$NAME" },
    { subdirectory: "packages/${APP}" }, { dockerfile: "$DOCKERFILE" },
  ])("rejects Compose interpolation in source fields: %o", (source) => {
    expect(() => validateRepoSource({ ...repoInput, ...source })).toThrow("must not contain $");
  });
});

describe("withImageEnvFile", () => {
  it.each([imageStack({ appName: "web-x1", image: "nginx:alpine" }), repoStack(repoInput)])(
    "adds variables to older managed image and repo apps without duplication",
    (compose) => {
      expect(withImageEnvFile(compose.replace("    env_file:\n      - .env\n", ""))).toBe(compose);
      expect(withImageEnvFile(compose)).toBe(compose);
    }
  );

  it("leaves ordinary compose files unchanged", () => {
    const compose = "services:\n  app:\n    image: nginx\n    restart: unless-stopped\n";
    expect(withImageEnvFile(compose)).toBe(compose);
  });
});
