import { describe, expect, it, vi } from "vitest";
import { ENGINES, inferEdges, type Service, type ServiceBase } from "./dokploy";
import { redactServiceForClient } from "./service-redaction";

vi.mock("server-only", () => ({}));
vi.mock("./docker", () => ({}));
vi.mock("./session", () => ({}));

const base: Omit<ServiceBase, "kind"> = {
  id: "service-id",
  name: "test-service",
  appName: "test-service-app",
  status: "idle",
  projectId: "project-id",
  projectName: "Test project",
  environmentId: "environment-id",
  environmentName: "production",
  dockerImage: "test-image:latest",
  env: "TOKEN=env-redaction-sentinel\nOTHER=second-value",
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: null,
};

const services: Service[] = [
  {
    ...base,
    kind: "application",
    sourceType: "docker",
    buildType: null,
    description: null,
    repository: null,
    dockerfile: null,
    dockerContextPath: null,
    dockerBuildStage: null,
    buildArgs: "BUILD_TOKEN=build-args-redaction-sentinel\nPUBLIC_KEY=visible-name",
    buildSecretsSupported: true,
    command: null,
    registryUrl: null,
    domains: [],
    redirects: [],
    ports: [],
    security: [],
    deployments: [],
    cpuReservation: null,
    memoryReservation: null,
    healthCheckSwarm: null,
    restartPolicySwarm: null,
    autoDeploy: false,
    branch: null,
    buildPath: null,
    gitUrl: null,
    watchPaths: [],
    webhookUrl: null,
  },
  {
    ...base,
    kind: "compose",
    composeFile: "services:\n  web:\n    image: nginx",
    composeType: "docker-compose",
    domains: [],
    deployments: [],
  },
  ...ENGINES.map((engine): Service => ({
    ...base,
    kind: "database",
    engine,
    databaseName: "test-db",
    databaseUser: "test-user",
    databasePassword: "database-password-redaction-sentinel",
    externalPort: null,
    command: null,
  })),
];

describe("redactServiceForClient", () => {
  it.each(services.map((service) => [
    service.kind === "database" ? service.engine : service.kind,
    service,
  ] as const))("removes %s env without mutating the server-side service", (_, service) => {
    const original = structuredClone(service);
    Object.freeze(service);

    const redacted = redactServiceForClient(service);

    expect(redacted).not.toBe(service);
    expect(redacted).toEqual({
      ...original,
      env: null,
      ...(service.kind === "application" ? { buildArgs: null } : {}),
      ...(service.kind === "database" ? { databasePassword: null } : {}),
    });
    expect(JSON.stringify(redacted)).not.toContain("env-redaction-sentinel");
    expect(service).toEqual(original);
  });

  it("omits build argument values and database passwords from serialized page props", () => {
    const pageProps = { services: services.map(redactServiceForClient) };
    const serialized = JSON.stringify(pageProps);

    expect(serialized).not.toContain("env-redaction-sentinel");
    expect(serialized).not.toContain("build-args-redaction-sentinel");
    expect(serialized).not.toContain("database-password-redaction-sentinel");
    expect(pageProps.services[0]).toMatchObject({
      buildArgs: null,
      buildSecretsSupported: true,
      sourceType: "docker",
    });
    for (const service of pageProps.services.filter((item) => item.kind === "database")) {
      expect(service).toMatchObject({
        databasePassword: null,
        databaseName: "test-db",
        databaseUser: "test-user",
      });
    }
  });

  it.each([null, ""])("handles an empty env (%s)", (env) => {
    expect(redactServiceForClient({ ...services[0], env }).env).toBeNull();
  });

  it("keeps env available to server-side edge inference after redaction", () => {
    const source: Service = { ...services[0], env: "DATABASE_URL=postgres://target-db:5432/app" };
    const target: Service = { ...services[2], id: "database-id", name: "target-db", appName: "target-db" };
    const original = [source, target];

    const redacted = original.map(redactServiceForClient);

    expect(inferEdges(original)).toEqual([{ source: source.id, target: target.id }]);
    expect(redacted.every((service) => service.env === null)).toBe(true);
    expect(source.env).toBe("DATABASE_URL=postgres://target-db:5432/app");
  });
});
