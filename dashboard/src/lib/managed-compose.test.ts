import { describe, expect, it } from "vitest";
import {
  MAX_MANAGED_HISTORY, bridgeImageDomain, imageStack, managedAppImage, parseManaged, recordManagedDeploy,
  repoSnapshotTag, repoStack, rewriteManagedApp, validateImageRef, validateManagedAppName, validateRepoSource,
  validateRepoTag, withImageEnvFile, writeManagedMeta, type ManagedDeployEntry, type ManagedMeta,
} from "./managed-compose";

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
      appName: "web-x1",
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
    expect(compose).toContain(`          - ${input.appName}\n`);
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

const timestamp = "2026-10-23T12:00:00.000Z";
const snapshot = repoSnapshotTag(repoInput.appName, timestamp);

describe("managed deploy metadata", () => {
  it.each(["image", "repo"] as const)("round-trips history and optional state for %s apps", (kind) => {
    const compose = kind === "image" ? imageStack({ appName: "web-x1", image: "nginx:alpine" }) : repoStack(repoInput);
    const original = parseManaged(compose)!;
    const meta: ManagedMeta = kind === "image"
      ? { kind, image: "nginx:alpine", history: [{ timestamp, image: "nginx:alpine" }], rollbackUnavailable: false }
      : { ...original, kind, repoUrl: repoInput.repoUrl, branch: "main", image: snapshot, pinnedTag: snapshot, history: [{ timestamp, image: snapshot }], rollbackUnavailable: true };
    const rewritten = writeManagedMeta(compose, meta);
    expect(parseManaged(rewritten)).toEqual(meta);
    expect(rewritten.slice(rewritten.indexOf("services:"))).toBe(compose.slice(compose.indexOf("services:")));
  });

  it("remains compatible with files without deploy history", () => {
    expect(parseManaged(imageStack({ appName: "web-x1", image: "nginx:alpine" }))).toEqual({ kind: "image", image: "nginx:alpine" });
    expect(parseManaged(repoStack(repoInput))).toEqual({ kind: "repo", image: "web-x1-app:latest", repoUrl: repoInput.repoUrl, branch: "main" });
  });

  it("does not interpret nested values as metadata", () => {
    const compose = imageStack({ appName: "web-x1", image: "nginx:alpine" }).replace("services:", "  extra:\n    kind: database\n    image: postgres:17\nservices:");
    expect(parseManaged(compose)).toEqual({ kind: "image", image: "nginx:alpine" });
  });

  it("ignores malformed entries and caps parsed history newest first", () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ timestamp: `2026-10-23T12:00:0${i}.000Z`, image: `nginx:v${i}` }));
    const bad = [{ timestamp: "yesterday", image: "nginx:alpine" }, { timestamp, image: "nginx:${TAG}" }, null];
    const compose = imageStack({ appName: "web-x1", image: "nginx:v7" }).replace("services:", `  history: ${JSON.stringify([...bad, ...history])}\nservices:`);
    expect(parseManaged(compose)).toMatchObject({ history: history.slice(3).reverse() });
    expect(parseManaged(compose.replace(/  history:.*\n/, "  history: definitely-not-json\n"))).toMatchObject({ history: [] });
  });

  it("supports CRLF and keeps following top-level comments and services unchanged", () => {
    const compose = imageStack({ appName: "web-x1", image: "nginx:alpine" }).replace("services:", "# app settings\nservices:").replaceAll("\n", "\r\n");
    const meta = { kind: "image", image: "nginx:alpine", history: [{ timestamp, image: "nginx:alpine" }] } as const;
    const rewritten = writeManagedMeta(compose, { ...meta, history: [...meta.history] });
    expect(rewritten).toContain("\r\n# app settings\r\nservices:\r\n");
    expect(parseManaged(rewritten)).toEqual(meta);
  });

  it("rejects duplicate metadata blocks and invalid persisted entries", () => {
    const compose = imageStack({ appName: "web-x1", image: "nginx:alpine" });
    expect(() => writeManagedMeta(`${compose}\nx-switchyard:\n  kind: image\n`, { kind: "image", image: "nginx:alpine" })).toThrow("ambiguous");
    expect(() => writeManagedMeta(compose, { kind: "image", image: "nginx:alpine", history: [{ timestamp: "yesterday", image: "nginx:alpine" }] })).toThrow("timestamp");
  });
});

describe("recordManagedDeploy", () => {
  const entries: ManagedDeployEntry[] = Array.from({ length: 6 }, (_, i) => ({
    timestamp: `2026-10-23T12:00:0${i}.000Z`, image: `web-x1-app:sy-${Date.parse(`2026-10-23T12:00:0${i}.000Z`)}`,
  }));

  it("caps history and reports only the oldest local snapshot for pruning", () => {
    const result = recordManagedDeploy(entries.slice(0, 5).reverse(), entries[5]);
    expect(result.history).toEqual(entries.slice(1).reverse());
    expect(result.history).toHaveLength(MAX_MANAGED_HISTORY);
    expect(result.pruned).toEqual([entries[0]]);
  });

  it("promotes a rollback and does not prune its retained tag", () => {
    const promoted = { ...entries[0], timestamp: "2026-10-23T12:00:09.000Z" };
    const result = recordManagedDeploy(entries.slice(0, 5).reverse(), promoted);
    expect(result.history).toEqual([promoted, ...entries.slice(1, 5).reverse()]);
    expect(result.pruned).toEqual([]);
  });

  it("accepts an absent history without mutating the caller's data", () => {
    expect(recordManagedDeploy(undefined, entries[0])).toEqual({ history: [entries[0]], pruned: [] });
    const original = entries.slice(0, 5);
    recordManagedDeploy(original, entries[5]);
    expect(original).toEqual(entries.slice(0, 5));
  });
});

describe("managed app rollback rewrites", () => {
  it("changes an image ref while preserving env, network aliases, labels and unrelated services", () => {
    const compose = imageStack({ appName: "web-x1", image: "nginx:new" })
      .replace("    restart:", '    labels:\n      - "traefik.http.routers.web.rule=Host(`web.example.com`)"\n    restart:')
      .replace("\nnetworks:\n", "\n  worker:\n    image: busybox:latest\nnetworks:\n");
    const changed = rewriteManagedApp(compose, "web-x1", { kind: "image", image: "nginx:old", history: [{ timestamp, image: "nginx:old" }] });
    expect(managedAppImage(changed)).toBe("nginx:old");
    expect(changed.slice(changed.indexOf("    labels:"))).toBe(compose.slice(compose.indexOf("    labels:")));
    expect(parseManaged(changed)).toMatchObject({ image: "nginx:old" });
    expect(managedAppImage(compose.replace("    image: nginx:new", "    image: nginx:edited"))).toBe("nginx:edited");
  });

  it("pins a repo without build or registry pulls and restores its exact source on redeploy", () => {
    const input = { ...repoInput, branch: "release/v2", subdirectory: "packages/web", dockerfile: "docker/web.Dockerfile" };
    const compose = repoStack(input).replace("    restart:", '    labels:\n      - "traefik.enable=true"\n    restart:');
    const meta = parseManaged(compose)!;
    if (meta.kind !== "repo") throw new Error("Expected repo metadata");
    const history = [{ timestamp, image: snapshot }];
    const pinned = rewriteManagedApp(compose, "web-x1", { ...meta, pinnedTag: snapshot, history });
    expect(pinned).not.toMatch(/^    build:/m);
    expect(pinned).toContain(`    image: ${snapshot}\n    pull_policy: never\n`);
    expect(pinned.slice(pinned.indexOf("    labels:"))).toBe(compose.slice(compose.indexOf("    labels:")));
    expect(parseManaged(pinned)).toMatchObject({ pinnedTag: snapshot, image: snapshot, history });
    const restored = rewriteManagedApp(pinned, "web-x1", { ...meta, history });
    expect(restored).toContain('    build:\n      context: "https://github.com/docker/welcome-to-docker.git#release/v2:packages/web"\n      dockerfile: docker/web.Dockerfile\n    image: web-x1-app:latest\n');
    expect(restored).not.toContain("pull_policy:");
    expect(parseManaged(restored)).not.toHaveProperty("pinnedTag");
    expect(restored.slice(restored.indexOf("services:"))).toBe(compose.slice(compose.indexOf("services:")));
  });

  it("rejects cross-app repo tags even when their image references are valid", () => {
    const compose = repoStack(repoInput);
    const meta = parseManaged(compose)!;
    if (meta.kind !== "repo") throw new Error("Expected repo metadata");
    expect(() => rewriteManagedApp(compose, "web-x1", { ...meta, pinnedTag: snapshot.replace("web-x1", "other") })).toThrow("rollback image tag");
    expect(() => rewriteManagedApp(compose, "web-x1", { ...meta, history: [{ timestamp, image: "nginx:alpine" }] })).toThrow("rollback image tag");
  });

  it.each([
    "services: {app: {image: nginx:latest}}\n",
    "services:\n  app:\n    image: nginx:latest\nservices :\n  app:\n    build: .\n",
    "services:\n  app: &app\n    image: nginx:latest\n",
    "services:\n  app:\n    image: nginx:latest\n    image: nginx:other\n",
    'services:\n  app:\n    image: nginx:latest\n    "image": nginx:other\n',
    "services:\n  app:\n    image: nginx:latest\n  'app':\n    image: nginx:other\n",
    "services:\n  <<: *shared\n  app:\n    image: nginx:latest\n",
    "services:\n  app:\n    <<: *shared\n    image: nginx:latest\n",
    "services:\n  app:\n    image: ${IMAGE}\n",
    'services:\n  app:\n    "build": .\n    image: nginx:latest\n',
    "services:\n  app:\n    'build': .\n    image: nginx:latest\n",
    "services:\n  app:\n    build : .\n    image: nginx:latest\n",
    "services:\n  app:\n    build: &shared\n      context: .\n    image: nginx:latest\n",
    "services:\n  app:\n    extends:\n      service: base\n    image: nginx:latest\n",
  ])("rejects unsupported or ambiguous app YAML: %s", (services) => {
    const compose = `x-switchyard:\n  kind: image\n  image: nginx:latest\n${services}`;
    expect(() => rewriteManagedApp(compose, "web-x1", { kind: "image", image: "nginx:old" })).toThrow();
  });
});

describe("rollback reference validation", () => {
  it.each([
    "nginx", "nginx:alpine", "ghcr.io/team/web:Release_1.2", "localhost:5000/team/web:v1",
    "registry.example.com/team/my__app:v1", "[::1]:5000/team/web:v1", `nginx@sha256:${"a".repeat(64)}`,
  ])("accepts Docker image reference %s", (ref) => {
    expect(() => validateImageRef(ref)).not.toThrow();
  });

  it.each([
    "", "nginx:latest\n", "nginx latest", "nginx:${TAG}", "nginx:$(id)", "nginx:`id`", "nginx;id",
    "https://registry.example.com/web:latest", "user:password@registry.example.com/web", "nginx@sha256:bad",
    "--help", "../nginx", "UPPERCASE/image:latest", "nginx:tag:other", "nginx:tag\u0000",
  ])("rejects unsafe or malformed Docker reference %s", (ref) => {
    expect(() => validateImageRef(ref)).toThrow();
  });

  it.each(["other-app:sy-1792756800000", "web-x1-app:latest", `${snapshot}\n`, `${snapshot};id`, "web-x1-app:sy-01", "web-x1-app:sy-9007199254740992"])("rejects invalid local snapshot %s", (tag) => {
    expect(() => validateRepoTag("web-x1", tag)).toThrow();
  });

  it("creates an immutable local tag from an ISO deployment timestamp", () => {
    expect(snapshot).toBe(`web-x1-app:sy-${Date.parse(timestamp)}`);
    expect(() => validateRepoTag("web-x1", snapshot)).not.toThrow();
    expect(() => repoSnapshotTag("web-x1", "yesterday")).toThrow("timestamp");
  });

  it.each(["web\ninjected: true", "web\n", "Web", "--flag", "web/other", "web$(id)"])("rejects unsafe managed app names %s", (appName) => {
    expect(() => validateManagedAppName(appName)).toThrow();
    expect(() => repoStack({ ...repoInput, appName })).toThrow();
    expect(() => imageStack({ appName, image: "nginx:alpine" })).toThrow();
  });
});
