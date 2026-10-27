import { describe, expect, it } from "vitest";
import { buildDuplicatePlan, duplicateServiceNameError, type DuplicateServiceRef } from "./service-duplicate";

function plan(source: Record<string, unknown>, ref: DuplicateServiceRef = { kind: "application", id: "original" }, suffix = "unique-123") {
  return buildDuplicatePlan({ source, ref, name: "api-copy", environmentId: "target", existingNames: [], suffix });
}

describe("duplicateServiceNameError", () => {
  it("accepts valid names and rejects names that cannot identify a service", () => {
    for (const name of ["a", "api-copy", " api-2 ", "a".repeat(63)]) expect(duplicateServiceNameError(name)).toBeNull();
    for (const name of ["", " ", "-api", "api-", "UPPER", "api copy", "a.b", "a".repeat(64)]) expect(duplicateServiceNameError(name)).not.toBeNull();
  });

  it("checks collisions case-insensitively within the selected environment", () => {
    expect(duplicateServiceNameError("api-copy", [" API-COPY "])).toContain("already exists");
    expect(duplicateServiceNameError("api-copy", ["api"])).toBeNull();
    expect(() => buildDuplicatePlan({ source: {}, ref: { kind: "application", id: "source" }, name: "api-copy", environmentId: "target", existingNames: ["api-copy"], suffix: "unique" })).toThrow("already exists");
  });
});

describe("application duplication", () => {
  it("copies source, build, environment, ports and resources using fresh identity", () => {
    const source = {
      applicationId: "original", name: "api", appName: "original-runtime", environmentId: "old",
      description: "API", serverId: "server", sourceType: "git", customGitUrl: "https://github.com/example/public.git",
      customGitBranch: "main", customGitBuildPath: "/api", customGitSSHKeyId: "ssh-reference", enableSubmodules: true,
      buildType: "dockerfile", dockerfile: "Dockerfile.api", dockerContextPath: ".", dockerBuildStage: "production",
      buildArgs: "MODE=release", buildSecrets: "FIXTURE=value", buildServerId: "build-server", buildRegistryId: "build-registry", createEnvFile: false, env: "MODE=demo",
      command: "node", args: ["server.js"], memoryReservation: "128", memoryLimit: "256", cpuReservation: "0.25", cpuLimit: "0.5", replicas: 2,
      ports: [{ portId: "old-port", applicationId: "original", publishedPort: 8123, targetPort: 3000, protocol: "tcp", publishMode: "host" }],
      refreshToken: "old-token", webhookToken: "old-webhook", domains: [{ host: "example.test" }], deployments: [{ deploymentId: "old-deploy" }],
      autoDeploy: true, applicationStatus: "running", isPreviewDeploymentsActive: true, labelsSwarm: { "traefik.http.routers.api.rule": "Host(`example.test`)" },
    };
    const copy = plan(source);
    expect(copy.create).toEqual({ name: "api-copy", environmentId: "target", sourceType: "git", description: "API", serverId: "server" });
    expect(copy.update).toMatchObject({
      sourceType: "git", customGitUrl: source.customGitUrl, customGitBranch: "main", customGitBuildPath: "/api", customGitSSHKeyId: "ssh-reference", enableSubmodules: true,
      buildType: "dockerfile", dockerfile: "Dockerfile.api", dockerContextPath: ".", dockerBuildStage: "production", buildArgs: "MODE=release", buildSecrets: "FIXTURE=value", buildServerId: "build-server", buildRegistryId: "build-registry",
      command: "node", args: ["server.js"], memoryReservation: "128", memoryLimit: "256", cpuReservation: "0.25", cpuLimit: "0.5", replicas: 2,
      autoDeploy: false, applicationStatus: "idle", isPreviewDeploymentsActive: false,
    });
    expect(copy.environment).toEqual({ env: "MODE=demo", createEnvFile: false, buildArgs: "MODE=release", buildSecrets: "FIXTURE=value" });
    expect(copy.ports).toEqual([{ publishedPort: 8123, targetPort: 3000, protocol: "tcp", publishMode: "host" }]);
    for (const key of ["applicationId", "appName", "environmentId", "serverId", "refreshToken", "webhookToken", "domains", "deployments", "labelsSwarm"]) expect(copy.update).not.toHaveProperty(key);
    expect(source.applicationStatus).toBe("running");
  });

  it.each([
    ["github", { repository: "repo", owner: "owner", branch: "release", buildPath: "/", githubId: "provider" }],
    ["gitlab", { gitlabProjectId: 123, gitlabRepository: "repo", gitlabOwner: "owner", gitlabBranch: "release", gitlabBuildPath: "/", gitlabPathNamespace: "owner/repo", gitlabId: "provider" }],
    ["gitea", { giteaRepository: "repo", giteaOwner: "owner", giteaBranch: "release", giteaBuildPath: "/", giteaId: "provider" }],
    ["bitbucket", { bitbucketRepository: "repo", bitbucketRepositorySlug: "repo", bitbucketOwner: "owner", bitbucketBranch: "release", bitbucketBuildPath: "/", bitbucketId: "provider" }],
    ["docker", { dockerImage: "nginx:alpine", registryUrl: "registry.example.test", registryId: "provider", username: "fixture", password: "fixture" }],
  ])("retains %s source settings without copying tokens", (sourceType, fields) => {
    const copy = plan({ sourceType, ...fields, refreshToken: "never-copy", github: { accessToken: "never-copy" } });
    expect(copy.update).toMatchObject({ sourceType, ...fields });
    expect(JSON.stringify(copy)).not.toContain("never-copy");
  });

  it("does not send nullable fields to schemas that expect optional strings", () => {
    const copy = plan({ env: null, repository: null, memoryLimit: null, buildArgs: null });
    expect(copy.update).not.toHaveProperty("repository");
    expect(copy.update).not.toHaveProperty("memoryLimit");
    expect(copy.update).not.toHaveProperty("buildArgs");
    expect(copy.environment).toBeUndefined();
  });

  it("supplies every required application.saveEnvironment field when build settings are absent", () => {
    expect(plan({ env: "MODE=demo", buildArgs: null, buildSecrets: null }).environment).toEqual({
      env: "MODE=demo", buildArgs: "", buildSecrets: "", createEnvFile: true,
    });
  });

  it("refuses uploaded source artifacts and malformed port mappings", () => {
    expect(() => plan({ sourceType: "drop" })).toThrow("Uploaded source files");
    expect(() => plan({ ports: [{ targetPort: 3000 }] })).toThrow("invalid port mapping");
  });
});

describe("mount duplication", () => {
  it("replaces named, bind and file mounts with empty unique named volumes", () => {
    const source = { mounts: [
      { mountId: "m1", type: "volume", mountPath: "/data", volumeName: "original-data" },
      { mountId: "m2", type: "volume", mountPath: "/same-data", volumeName: "original-data" },
      { type: "bind", mountPath: "/cache", hostPath: "/host/source" },
      { type: "file", mountPath: "/settings", filePath: "settings", content: "source-data" },
    ] };
    const copy = plan(source);
    expect(copy.mounts).toEqual([
      { type: "volume", mountPath: "/data", volumeName: "api-copy-unique-123-1" },
      { type: "volume", mountPath: "/same-data", volumeName: "api-copy-unique-123-1" },
      { type: "volume", mountPath: "/cache", volumeName: "api-copy-unique-123-2" },
      { type: "volume", mountPath: "/settings", volumeName: "api-copy-unique-123-3" },
    ]);
    expect(JSON.stringify(copy)).not.toMatch(/original-data|source-data|host\/source|mountId/);
    expect(plan(source, undefined, "another-123").mounts[0].volumeName).not.toBe(copy.mounts[0].volumeName);
    expect(source.mounts[0].volumeName).toBe("original-data");
  });

  it("validates mount paths and suffixes before API mutations", () => {
    expect(() => plan({ mounts: [{ mountPath: "relative" }] })).toThrow("invalid mount path");
    expect(() => plan({}, undefined, "../bad")).toThrow("unique volume suffix");
  });
});

describe("compose duplication", () => {
  const composeRef: DuplicateServiceRef = { kind: "compose", id: "original" };
  const composeFile = `name: original-project
services:
  api:
    image: nginx:alpine
    container_name: original-container
    label_file: original-routing.env
    environment:
      MODE: demo
    ports:
      - "8080:80"
    labels:
      - traefik.http.routers.api.rule=Host(\u0060example.test\u0060)
    deploy:
      labels:
        caddy: example.test
      resources:
        limits:
          memory: 128M
    volumes:
      - data:/data
      - /host/cache:/cache:ro
      - type: volume
        source: data
        target: /shared
  worker:
    image: busybox
    volumes:
      - data:/data
volumes:
  data:
    external: true
    name: original-global-data
    driver_opts:
      device: /host/data
`;

  it("copies a raw configuration snapshot with fresh empty volumes and no domain routing", () => {
    const source = { composeFile, composeType: "docker-compose", sourceType: "github", repository: "original", env: "MODE=demo", createEnvFile: true, refreshToken: "never-copy", domains: [{ host: "example.test" }], autoDeploy: true };
    const copy = plan(source, composeRef);
    expect(copy.create).toEqual({ name: "api-copy", environmentId: "target", composeType: "docker-compose", sourceType: "raw" });
    expect(copy.update).toMatchObject({ sourceType: "raw", autoDeploy: false, composeStatus: "idle", composeType: "docker-compose" });
    expect(copy.update).not.toHaveProperty("repository");
    expect(copy.environment).toEqual({ env: "MODE=demo", createEnvFile: true });
    const text = String(copy.update.composeFile);
    expect(text).toContain("MODE: demo");
    expect(text).toContain("8080:80");
    expect(text).toContain("memory: 128M");
    expect(text.match(/source: api-copy-unique-123-1/g)).toHaveLength(3);
    expect(text).toContain("name: api-copy-unique-123-1");
    expect(text).toContain("read_only: true");
    expect(text).not.toMatch(/original|example\.test|traefik|caddy|container_name|external|driver_opts|\/host\//);
    expect(source.composeFile).toBe(composeFile);
  });

  it("handles YAML merge anchors, interpolation, anonymous mounts and long binds", () => {
    const copy = plan({ composeFile: `services:
  api: &base
    image: busybox
    volumes:
      - \u0024{DATA:-shared}:/data:ro
      - /anonymous
      - type: bind
        source: ./local
        target: /local
        bind:
          propagation: shared
      - type: tmpfs
        target: /memory
  worker:
    <<: *base
` }, composeRef);
    const text = String(copy.update.composeFile);
    expect(text).not.toMatch(/\$\{DATA|\.\/local|type: bind|propagation/);
    expect(text).toContain("type: tmpfs");
    expect(text.match(/source: api-copy-unique-123-1/g)).toHaveLength(2);
    expect(text).toContain("target: /anonymous");
  });

  it.each([
    ["", "Save the source compose file"],
    ["services: [", "valid, non-cyclic YAML"],
    ["services: &cycle {api: *cycle}", "valid, non-cyclic YAML"],
    ["volumes: {}", "must contain services"],
    ["include: source.yml\nservices: {api: {image: nginx}}", "Flatten compose includes"],
    ["services: {api: {extends: {file: source.yml, service: api}}}", "Flatten compose extends"],
    ["services: {api: {volumes_from: [other]}}", "Flatten compose extends"],
    ["services: {api: {volumes: [data:relative]}}", "absolute container paths"],
  ])("refuses unsafe or unsupported compose input %s", (composeFile, message) => {
    expect(() => plan({ composeFile }, composeRef)).toThrow(message);
  });
});

describe("database duplication", () => {
  it.each(["postgres", "mysql", "mariadb", "mongo", "redis"] as const)("copies %s configuration without backups, source identity or data", (engine) => {
    const source = {
      appName: "original-runtime", databaseName: "fixture", databaseUser: "fixture", databasePassword: "fixture-password", databaseRootPassword: "fixture-root",
      dockerImage: `${engine}:latest`, replicaSets: true, env: "MODE=demo", externalPort: 12345, command: "--setting", args: ["--flag"], cpuLimit: "1", memoryLimit: "256", replicas: 1,
      backups: [{ schedule: "* * * * *" }], deployments: [{ id: "original-deployment" }], domains: [{ host: "example.test" }], applicationStatus: "running",
      mounts: [{ type: "volume", volumeName: "original-data", mountPath: "/data" }],
    };
    const copy = plan(source, { kind: "database", id: "original", engine });
    expect(copy.create).toMatchObject({ name: "api-copy", environmentId: "target", dockerImage: `${engine}:latest`, databasePassword: "fixture-password" });
    expect(copy.create).not.toHaveProperty("appName");
    expect(copy.create.databaseUser).toBe(engine === "redis" ? undefined : "fixture");
    expect(copy.create.databaseName).toBe(engine === "redis" || engine === "mongo" ? undefined : "fixture");
    expect(copy.create.databaseRootPassword).toBe(engine === "mysql" || engine === "mariadb" ? "fixture-root" : undefined);
    expect(copy.create.replicaSets).toBe(engine === "mongo" ? true : undefined);
    expect(copy.update).toEqual({ externalPort: 12345, command: "--setting", args: ["--flag"], cpuLimit: "1", memoryLimit: "256", replicas: 1, applicationStatus: "idle" });
    expect(copy.environment).toEqual({ env: "MODE=demo" });
    expect(copy.mounts[0].volumeName).not.toBe("original-data");
    expect(JSON.stringify(copy)).not.toMatch(/backups|deployments|domains|original-runtime|original-deployment|example\.test/);
  });
});
