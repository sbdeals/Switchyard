import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppBuildTab, AppDeployTab, DeploymentsTab } from "../components/service/AppTabs";
import { DirtyGuardProvider } from "../components/DirtyGuard";
import { loadServiceCommandsAction, loadServiceWebhookAction } from "@/app/actions";
import type { Application } from "./dokploy";

vi.mock("@/app/actions", () => ({
  loadServiceCommandsAction: vi.fn(),
  loadServiceWebhookAction: vi.fn(),
}));

const app: Application = {
  kind: "application",
  id: "app-id",
  name: "test-app",
  appName: "test-app",
  status: "idle",
  projectId: "project-id",
  projectName: "Test project",
  environmentId: "environment-id",
  environmentName: "test",
  dockerImage: null,
  env: null,
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: null,
  sourceType: "git",
  buildType: "nixpacks",
  description: null,
  repository: "https://example.com/repo.git",
  dockerfile: null,
  dockerContextPath: null,
  dockerBuildStage: null,
  command: "TOKEN=sentinel-command node app.js",
  registryUrl: null,
  domains: [],
  redirects: [],
  ports: [],
  security: [],
  deployments: [],
  cpuReservation: null,
  memoryReservation: null,
  healthCheckSwarm: { Test: ["CMD-SHELL", "curl -H 'Authorization: sentinel-health' http://localhost"] },
  restartPolicySwarm: null,
  autoDeploy: false,
  branch: "main",
  buildPath: null,
  gitUrl: "https://example.com/repo.git",
  watchPaths: [],
  webhookUrl: "https://example.com/deploy/sentinel-webhook",
  hasWebhook: true,
};

beforeEach(() => vi.clearAllMocks());

describe("application secret editors", () => {
  it("renders a masked webhook with explicit reveal and copy controls without loading it", () => {
    const html = renderToStaticMarkup(createElement(DirtyGuardProvider, null,
      createElement(DeploymentsTab, { app }),
    ));

    expect(html).toContain("••••••••••••••••");
    expect(html).toContain('aria-label="Reveal deploy webhook"');
    expect(html).toContain('aria-label="Copy deploy webhook"');
    expect(html).not.toContain("sentinel-webhook");
    expect(loadServiceWebhookAction).not.toHaveBeenCalled();
  });

  it("uses only hasWebhook to show webhook availability", () => {
    const html = renderToStaticMarkup(createElement(DirtyGuardProvider, null,
      createElement(DeploymentsTab, { app: { ...app, hasWebhook: false } }),
    ));

    expect(html).toContain("No webhook token yet");
    expect(html).not.toContain("Reveal deploy webhook");
    expect(html).not.toContain("sentinel-webhook");
    expect(loadServiceWebhookAction).not.toHaveBeenCalled();
  });

  it.each([
    ["Build", AppBuildTab, "Custom run command"],
    ["Deploy", AppDeployTab, "Test command"],
  ] as const)("keeps the %s command editor unmounted until its secret request resolves", (_, tab, field) => {
    const html = renderToStaticMarkup(createElement(DirtyGuardProvider, null,
      createElement(tab, { app }),
    ));

    expect(html).toContain('aria-label="Loading service commands"');
    expect(html).not.toContain("sentinel-command");
    expect(html).not.toContain("sentinel-health");
    expect(html).not.toContain(field);
    expect(loadServiceCommandsAction).not.toHaveBeenCalled();
  });
});
