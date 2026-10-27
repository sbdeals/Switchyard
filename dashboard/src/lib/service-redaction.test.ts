import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ENGINES, inferEdges, type Application, type ComposeService, type Service, type ServiceBase } from "./dokploy";
import { redactServiceForClient } from "./service-redaction";
import { ComposeDomainsTab, ComposeEditorTab } from "../components/service/ComposeTabs";
import { DirtyGuardProvider } from "../components/DirtyGuard";

vi.mock("server-only", () => ({}));
vi.mock("./docker", () => ({}));
vi.mock("./session", () => ({}));
vi.mock("@/app/actions", () => ({}));

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
    databasePassword: null,
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
    expect(redacted.env).toBeNull();
    expect(JSON.stringify(redacted)).not.toContain("env-redaction-sentinel");
    expect(service).toEqual(original);
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

  it("removes webhook, inline commands and unused description without changing server data", () => {
    const service: Application = {
      ...services[0] as Application,
      webhookUrl: "http://localhost:3000/api/deploy/webhook-sentinel",
      command: "TOKEN=command-sentinel node server.js",
      healthCheckSwarm: { Test: ["CMD-SHELL", "curl -H 'Authorization: health-sentinel' localhost"], Retries: 3 },
      description: "description-sentinel",
    };
    const original = structuredClone(service);
    const redacted = redactServiceForClient(service) as Application;

    expect(redacted).toMatchObject({
      webhookUrl: null, hasWebhook: true, command: null, healthCheckSwarm: null, description: null,
    });
    expect(JSON.stringify(redacted)).not.toMatch(/webhook-sentinel|command-sentinel|health-sentinel|description-sentinel/);
    expect(service).toEqual(original);
    expect(redactServiceForClient(services[0])).toHaveProperty("hasWebhook", false);
  });

  it("strips URL credentials from every URL-bearing application prop", () => {
    const url = "https://sentinel-user:token-sentinel@example.com/repo.git";
    const service: Application = {
      ...services[0] as Application,
      gitUrl: url, repository: url, dockerImage: url, registryUrl: url,
      redirects: [{ redirectId: "redirect", regex: "^/old", replacement: url, permanent: true }],
    };
    const redacted = redactServiceForClient(service) as Application;

    for (const field of ["gitUrl", "repository", "dockerImage", "registryUrl"] as const) {
      expect(redacted[field]).toBe("https://example.com/repo.git");
      expect(service[field]).toBe(url);
    }
    expect(redacted.redirects[0].replacement).toBe("https://example.com/repo.git");
    expect(service.redirects[0].replacement).toBe(url);
    expect(JSON.stringify(redacted)).not.toMatch(/sentinel-user|token-sentinel/);
  });

  it.each(ENGINES)("redacts %s commands and image userinfo, leaving databasePassword to #134", (engine) => {
    const service: Service = {
      ...services[2], kind: "database", engine,
      databaseName: "db", databaseUser: "user", externalPort: null,
      command: "--password command-sentinel",
      dockerImage: "https://user:image-sentinel@registry.example/image",
      databasePassword: "out-of-scope",
    };
    expect(redactServiceForClient(service)).toMatchObject({
      command: null, dockerImage: "https://registry.example/image", databasePassword: "out-of-scope",
    });
    expect(service.command).toContain("command-sentinel");
  });

  it("replaces compose YAML with only the metadata the client consumes", () => {
    const compose: ComposeService = {
      ...services[1] as ComposeService,
      composeFile: "services:\n  web: # public\n    image: nginx\n    environment:\n      TOKEN: compose-sentinel\n  db:\n    image: 'postgres:17'\nvolumes:\n  data:\n",
    };
    const redacted = redactServiceForClient(compose) as ComposeService;

    expect(redacted).toMatchObject({ composeFile: null, serviceNames: ["web", "db"], hasPostgres: true });
    expect(JSON.stringify(redacted)).not.toContain("compose-sentinel");
    expect(compose.composeFile).toContain("compose-sentinel");
    const html = renderToStaticMarkup(createElement(DirtyGuardProvider, null,
      createElement(ComposeDomainsTab, { compose: redacted }),
    ));
    expect(html).toContain('<option value="web"');
    expect(html).toContain('<option value="db"');
    expect(html).not.toContain("compose-sentinel");
  });

  it.each([null, "", "invalid yaml", "services:\n  web:\n    image: nginx"])("handles compose metadata without postgres (%s)", (composeFile) => {
    const redacted = redactServiceForClient({ ...services[1] as ComposeService, composeFile }) as ComposeService;
    expect(redacted.composeFile).toBeNull();
    expect(redacted.hasPostgres).toBe(false);
    expect(redacted.serviceNames).toEqual(composeFile?.includes("web:") ? ["web"] : []);
  });

  it("keeps the compose editor unavailable until its lazy fetch completes", () => {
    const compose = { ...services[1] as ComposeService, composeFile: "TOKEN=compose-prop-sentinel" };
    const html = renderToStaticMarkup(createElement(DirtyGuardProvider, null,
      createElement(ComposeEditorTab, { compose }),
    ));

    expect(html).toContain("Loading compose file");
    expect(html).not.toContain("compose-prop-sentinel");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<button");
  });
});
