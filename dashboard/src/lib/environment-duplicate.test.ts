import { describe, expect, it } from "vitest";
import {
  DuplicateValidationError,
  planEnvironmentDuplicate,
  summarizeEnvironmentDuplicate,
  type DuplicateOptions,
  type RawDuplicateService,
} from "./environment-duplicate";

const project = {
  projectId: "project-1", name: "Example",
  environments: [{ environmentId: "source-env", name: "production", env: "SHARED=environment-value" }],
};
const options: DuplicateOptions = { projectId: "project-1", sourceEnvironmentId: "source-env", name: "staging" };
const compose = (name = "api", detail: Record<string, unknown> = {}): RawDuplicateService => ({
  type: "compose", id: `${name}-id`,
  detail: {
    name, sourceType: "raw", composeType: "docker-compose",
    composeFile: "services:\n  api:\n    image: nginx:alpine\n", env: "MODE=test\nUPSTREAM=http://worker:8080",
    ...detail,
  },
});

describe("planEnvironmentDuplicate", () => {
  it("defaults to copying variables without deployment and preserves two service names and references", () => {
    const plan = planEnvironmentDuplicate(project, { ...options, name: " staging " }, [compose(), compose("worker")]);
    expect(plan.options).toEqual({ ...options, copyVariables: true, deploy: false });
    expect(plan.services.map((service) => service.name)).toEqual(["api", "worker"]);
    expect(plan.services[0].env).toBe("MODE=test\nUPSTREAM=http://worker:8080");
    expect(plan.services[0].update).toMatchObject({ sourceType: "raw", composeType: "docker-compose", autoDeploy: false });
    expect(plan.environment).toEqual({ env: "SHARED=environment-value" });
  });

  it.each(["", " ", "a".repeat(65), "../stage", "staging\nnext", "-staging"])("rejects invalid environment name %j", (name) => {
    expect(() => planEnvironmentDuplicate(project, { ...options, name }, [])).toThrow(DuplicateValidationError);
  });

  it("rejects case-insensitive environment collisions and Dokploy's reserved name", () => {
    const existing = { ...project, environments: [...project.environments, { environmentId: "stage", name: " Staging " }] };
    expect(() => planEnvironmentDuplicate(existing, { ...options, name: "STAGING" }, [])).toThrow("already exists");
    expect(() => planEnvironmentDuplicate(project, { ...options, name: "Production" }, [])).toThrow("reserves");
  });

  it("validates project/source membership and source names before any writes", () => {
    expect(() => planEnvironmentDuplicate(project, { ...options, projectId: "other" }, [])).toThrow("project does not match");
    expect(() => planEnvironmentDuplicate(project, { ...options, sourceEnvironmentId: "deleted" }, [])).toThrow("no longer exists");
    expect(() => planEnvironmentDuplicate(project, options, [compose("api", { environmentId: "other" })])).toThrow("does not belong");
    expect(() => planEnvironmentDuplicate(project, options, [compose(), compose("API")])).toThrow("unique names");
    expect(() => planEnvironmentDuplicate(project, options, [compose(" ")])).toThrow("must have a name");
  });

  it("rejects invalid boolean options", () => {
    expect(() => planEnvironmentDuplicate(project, { ...options, deploy: "false" as unknown as boolean }, [])).toThrow(DuplicateValidationError);
  });

  it("strips identities, domains, deployment history, webhook tokens and automatic deployment", () => {
    const source = compose("api", {
      composeId: "old", appName: "old-stack", environmentId: "source-env",
      autoDeploy: true, refreshToken: "webhook-secret", deployments: [{ id: "deploy" }],
      domains: [{ domainId: "domain", host: "api.example.test" }],
    });
    const plan = planEnvironmentDuplicate(project, options, [source]);
    expect(plan.services[0].create).toEqual({ name: "api" });
    expect(plan.services[0].update).not.toHaveProperty("appName");
    expect(plan.services[0].update).not.toHaveProperty("refreshToken");
    expect(plan.services[0].update).not.toHaveProperty("domains");
    expect(plan.services[0].update).not.toHaveProperty("deployments");
    expect(plan.services[0].update.autoDeploy).toBe(false);
    expect(plan.domainsNotCopied).toEqual(["api.example.test"]);
  });

  it("copies provider/build settings, saved build secrets and ports without source IDs", () => {
    const source: RawDuplicateService = {
      type: "application", id: "app-old", detail: {
        name: "web", serverId: "server", sourceType: "gitlab", gitlabId: "provider", gitlabRepository: "repo",
        gitlabPathNamespace: "team/repo", gitlabBranch: "main", gitlabBuildPath: "/site", buildType: "dockerfile",
        dockerfile: "ops/Dockerfile", dockerContextPath: ".", dockerBuildStage: "runner", memoryLimit: "256m",
        healthCheckSwarm: { Test: ["CMD", "true"] }, env: "TOKEN=fixture-secret", buildArgs: "MODE=production",
        buildSecrets: "BUILD_TOKEN=fixture-build-secret", createEnvFile: true, dockerImage: null,
        ports: [{ portId: "old-port", applicationId: "app-old", publishedPort: 8080, targetPort: 80, protocol: "tcp", publishMode: "ingress" }],
      },
    };
    const service = planEnvironmentDuplicate(project, options, [source]).services[0];
    expect(service.create.serverId).toBe("server");
    expect(service.update).toMatchObject({ sourceType: "gitlab", gitlabId: "provider", gitlabPathNamespace: "team/repo", dockerfile: "ops/Dockerfile", memoryLimit: "256m" });
    expect(service.update).not.toHaveProperty("dockerImage");
    expect(service.update).not.toHaveProperty("env");
    expect(service.environment).toEqual({ env: "TOKEN=fixture-secret", buildArgs: "MODE=production", buildSecrets: "BUILD_TOKEN=fixture-build-secret", createEnvFile: true });
    expect(service.ports).toEqual([{ publishedPort: 8080, targetPort: 80, protocol: "tcp", publishMode: "ingress" }]);
    expect(service.warnings.join(" ")).toContain("ports are preserved");
  });

  it.each(["githubId", "gitlabId", "bitbucketId", "giteaId", "customGitSSHKeyId"])("preserves source provider association %s", (field) => {
    const source: RawDuplicateService = { type: "application", id: "app", detail: { name: "app", [field]: "provider" } };
    expect(planEnvironmentDuplicate(project, options, [source]).services[0].update[field]).toBe("provider");
  });

  it("omits saved variables and build arguments/secrets when copy variables is off", () => {
    const source: RawDuplicateService = {
      type: "application", id: "app", detail: { name: "app", env: "TOKEN=secret", buildArgs: "ARG=secret", buildSecrets: "SECRET=secret" },
    };
    const plan = planEnvironmentDuplicate(project, { ...options, copyVariables: false }, [source]);
    expect(plan.environment).toBeUndefined();
    expect(plan.services[0].env).toBeUndefined();
    expect(plan.services[0].environment).toBeUndefined();
    expect(JSON.stringify(plan)).not.toContain("secret");
  });

  it.each([undefined, null, ""])("normalizes missing variables (%j) to valid saveEnvironment payloads", (env) => {
    const services: RawDuplicateService[] = [
      compose("compose", { env }),
      { type: "application", id: "app", detail: { name: "app", env, buildArgs: null, buildSecrets: null, createEnvFile: null } },
      { type: "redis", id: "db", detail: { name: "db", env, databasePassword: "fixture-password" } },
    ];
    const plan = planEnvironmentDuplicate(project, options, services);
    expect(plan.services.map((service) => service.env)).toEqual(["", "", ""]);
    expect(plan.services[0].environment).toEqual({ env: "" });
    expect(plan.services[1].environment).toEqual({ env: "", buildArgs: "", buildSecrets: "", createEnvFile: true });
    expect(plan.services[2].environment).toEqual({ env: "" });
  });

  it("preserves inline Compose settings while making the saved-variable scope explicit", () => {
    const composeFile = "services:\n  api:\n    image: nginx:alpine\n    environment:\n      MODE: inline\n";
    const service = planEnvironmentDuplicate(project, { ...options, copyVariables: false }, [compose("api", { composeFile })]).services[0];
    expect(service.update.composeFile).toBe(composeFile);
    expect(service.env).toBeUndefined();
    expect(service.warnings.join(" ")).toContain("Copy variables controls saved Variables entries");
  });

  it("copies mount definitions but requires the executor to create fresh named volumes", () => {
    const source = compose();
    source.mounts = [{ mountId: "old-mount", serviceId: "old", type: "volume", mountPath: "/data", volumeName: "production-data" }];
    expect(planEnvironmentDuplicate(project, options, [source]).services[0].mounts).toEqual([{ type: "volume", mountPath: "/data", sourceVolumeName: "production-data" }]);
  });

  it("retains private source volume identity so shared mount topology can be recreated", () => {
    const source = compose();
    source.mounts = [
      { type: "volume", mountPath: "/data", volumeName: "shared-data" },
      { type: "volume", mountPath: "/other", volumeName: "shared-data" },
    ];
    const plan = planEnvironmentDuplicate(project, options, [source]);
    expect(plan.services[0].mounts.map((mount) => mount.sourceVolumeName)).toEqual(["shared-data", "shared-data"]);
    expect(plan.services[0].mounts.every((mount) => mount.volumeName === undefined)).toBe(true);
    expect(JSON.stringify(summarizeEnvironmentDuplicate(plan))).not.toContain("shared-data");
  });

  it("keeps bind definitions with a sharing warning and refuses deployment until reviewed", () => {
    const source = compose();
    source.mounts = [{ type: "bind", hostPath: "/srv/data", mountPath: "/data" }];
    const service = planEnvironmentDuplicate(project, options, [source]).services[0];
    expect(service.mounts[0].hostPath).toBe("/srv/data");
    expect(service.warnings.join(" ")).toContain("may share existing data");
    expect(() => planEnvironmentDuplicate(project, { ...options, deploy: true }, [source])).toThrow("turn off deploy");
  });

  it("permits deployment of ordinary Compose project-scoped volumes", () => {
    const composeFile = "services:\n  api:\n    image: nginx:alpine\n    volumes:\n      - data:/data\nvolumes:\n  data:\n";
    expect(planEnvironmentDuplicate(project, { ...options, deploy: true }, [compose("api", { composeFile })]).options.deploy).toBe(true);
  });

  it.each([
    "volumes:\n  data:\n    external: true\n",
    "volumes:\n  data:\n    name: source-data\n",
    "services:\n  api:\n    container_name: source-api\n",
    "services:\n  api:\n    volumes:\n      - /srv/data:/data\n",
    'services:\n  api:\n    volumes:\n      - "/srv/data:/data"\n',
    'volumes:\n  data:\n    "name": source-data\n',
    'services:\n  api:\n    "container_name": source-api\n',
    '{"services":{"api":{"image":"nginx","volumes":[{"type":"bind","source":"/srv/data","target":"/data"}]}}}',
  ])("preserves risky Compose definitions and blocks automatic deployment", (composeFile) => {
    expect(planEnvironmentDuplicate(project, options, [compose("api", { composeFile })]).services[0].update.composeFile).toBe(composeFile);
    expect(() => planEnvironmentDuplicate(project, { ...options, deploy: true }, [compose("api", { composeFile })])).toThrow("turn off deploy");
  });

  it("preserves repository Compose source and custom commands for review without deploying", () => {
    const source = compose("api", { sourceType: "git", customGitUrl: "https://example.test/repo.git", command: "docker compose -p source up -d" });
    expect(planEnvironmentDuplicate(project, options, [source]).services[0].update.command).toBe(source.detail.command);
    expect(() => planEnvironmentDuplicate(project, { ...options, deploy: true }, [source])).toThrow("turn off deploy");
  });

  it("preserves Compose randomization suffixes for review without deploying", () => {
    const source = compose("api", { randomize: true, suffix: "source-suffix" });
    const service = planEnvironmentDuplicate(project, options, [source]).services[0];
    expect(service.update).toMatchObject({ randomize: true, suffix: "source-suffix" });
    expect(service.warnings.join(" ")).toContain("randomization suffix is preserved");
    expect(() => planEnvironmentDuplicate(project, { ...options, deploy: true }, [source])).toThrow("turn off deploy");
  });

  it.each([
    'labels:\n  - "traefik.http.routers.api.rule=Host(`api.example.test`)"',
    'labels:\n  caddy: api.example.test',
  ])("rejects embedded domain routes instead of silently copying them", (composeFile) => {
    expect(() => planEnvironmentDuplicate(project, options, [compose("api", { composeFile })])).toThrow("embedded proxy domain routes");
  });

  it("rejects application proxy labels and uploaded filesystem sources", () => {
    const source: RawDuplicateService = { type: "application", id: "app", detail: { name: "app", labelsSwarm: { "traefik.http.routers.app.rule": "Host(`test.example`)" } } };
    expect(() => planEnvironmentDuplicate(project, options, [source])).toThrow("embedded proxy domain routes");
    source.detail = { name: "app", sourceType: "drop" };
    expect(() => planEnvironmentDuplicate(project, options, [source])).toThrow("uploaded source");
  });

  it("copies database settings separately from optional env and never copies backup destinations", () => {
    const source: RawDuplicateService = { type: "postgres", id: "db", detail: { name: "db", databaseName: "app", databaseUser: "app", databasePassword: "db-fixture-secret", dockerImage: "postgres:17", env: "EXTRA=off", externalPort: 5435, backups: [{ destinationId: "production" }] } };
    const service = planEnvironmentDuplicate(project, { ...options, copyVariables: false }, [source]).services[0];
    expect(service.create).toMatchObject({ databaseName: "app", databaseUser: "app", databasePassword: "db-fixture-secret", dockerImage: "postgres:17" });
    expect(service.update.externalPort).toBe(5435);
    expect(service.update).not.toHaveProperty("backups");
    expect(service.env).toBeUndefined();
    expect(service.warnings).toContain("Database login settings are copied; stored data is not.");
  });

  it("does not mutate source details or reuse nested setting references", () => {
    const source = compose();
    source.detail.watchPaths = ["src/**"];
    const before = JSON.stringify(source);
    const plan = planEnvironmentDuplicate(project, options, [source]);
    (plan.services[0].update.watchPaths as string[]).push("other/**");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("supports empty environments", () => {
    expect(planEnvironmentDuplicate(project, options, []).services).toEqual([]);
  });
});

describe("summarizeEnvironmentDuplicate", () => {
  it("counts variables without revealing values, credentials, source payloads or mount content", () => {
    const source = compose("api", { env: "# hidden comment\nTOKEN=fixture-variable-secret\nexport URL=http://worker:8080\n\n", composeFile: "services:\n  api:\n    image: nginx:alpine\n# fixture-file-secret\n" });
    source.mounts = [{ type: "file", mountPath: "/config", filePath: "config", content: "fixture-mount-secret" }];
    const summary = summarizeEnvironmentDuplicate(planEnvironmentDuplicate(project, options, [source]));
    expect(summary.environmentVariableCount).toBe(1);
    expect(summary.services[0]).toMatchObject({ name: "api", type: "compose", variableCount: 2, mountCount: 1, portCount: 0 });
    expect(JSON.stringify(summary)).not.toContain("fixture-");
    expect(JSON.stringify(summary)).not.toContain("environment-value");
    expect(summary).not.toHaveProperty("environment");
  });
});
