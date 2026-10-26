import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ composeLifecycleAction: vi.fn(), rollbackDeploymentAction: vi.fn() }));
vi.mock("@/app/deploy-hook-actions", () => ({ getDeployHookAction: vi.fn(), updateDeployHookAction: vi.fn() }));
vi.mock("@/components/service/AppTabs", () => ({ DomainRow: () => null }));

import { DeployHookInstructions, PreviewSettings } from "@/components/service/DeployHookPanel";
import { ComposeOverviewTab, ComposeSettingsTab } from "@/components/service/ComposeTabs";
import { DeploymentHistory } from "@/components/service/DeployActivity";
import type { ComposeService } from "./dokploy";

const compose: ComposeService = {
  kind: "compose",
  id: "repo-service",
  name: "web",
  appName: "web-test",
  status: "done",
  projectId: "project-1",
  projectName: "test",
  environmentId: "environment-1",
  environmentName: "production",
  dockerImage: null,
  env: null,
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: null,
  composeFile: null,
  composeType: "docker-compose",
  domains: [],
  deployments: [],
  managed: { kind: "repo", image: "web-test:latest", repoUrl: "https://github.com/example/web", branch: "main" },
};

describe("deploy-on-push settings", () => {
  it("shows opt-in preview/fork switches, env/access disclosure, active URLs and manual cleanup", () => {
    const hook = { enabled: true, path: "/hook", secret: "test", previewsEnabled: true, allowForks: false,
      previews: [{ number: 12, branch: "feature/header", title: "Header", url: "http://preview.example.test" }] };
    const markup = renderToStaticMarkup(createElement(PreviewSettings, { hook, pending: false, onChange() {}, onDelete() {} }));
    expect(markup).toContain('aria-label="PR previews"');
    expect(markup).toContain('aria-label="Allow fork PR previews"');
    expect(markup).toContain("fork code receives the parent");
    expect(markup).toContain("encrypted automation API key");
    expect(markup).toContain("PR #12 · feature/header");
    expect(markup).toContain('href="http://preview.example.test"');
    expect(markup).toContain("Delete preview");
    const instructions = renderToStaticMarkup(createElement(DeployHookInstructions, { hook, origin: "http://dashboard.test" }));
    expect(instructions).toContain("Pushes and Pull requests");
  });
  it("shows exact GitHub setup with a masked, copyable secret and session-independent authorization", () => {
    const markup = renderToStaticMarkup(createElement(DeployHookInstructions, {
      origin: "https://switchyard.example.com",
      hook: {
        enabled: true,
        path: "/api/hooks/deploy/test-token",
        secret: "test-secret",
      },
    }));
    expect(markup).toContain("Settings → Webhooks → Add webhook");
    expect(markup).toContain("Payload URL");
    expect(markup).toContain('value="https://switchyard.example.com/api/hooks/deploy/test-token"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('value="test-secret"');
    expect(markup).toContain('aria-label="Show webhook secret"');
    expect(markup.match(/aria-label="Copy to clipboard"/g)).toHaveLength(2);
    expect(markup).toContain("application/json");
    expect(markup).toContain("Just the push event");
    expect(markup).toContain("Active");
    expect(markup).toContain("externally reachable dashboard URL");
    expect(markup).toContain("This hook keeps working when you sign out");
  });

  it("offers deploy on push in managed repo settings only", () => {
    const render = (service: ComposeService) => renderToStaticMarkup(createElement(ComposeSettingsTab, {
      compose: service,
      onClose: () => {},
    }));
    const repoMarkup = render(compose);
    expect(repoMarkup).toContain('role="switch"');
    expect(repoMarkup).toContain('aria-checked="false"');
    expect(repoMarkup).toContain("Automatically deploy pushes to");
    expect(repoMarkup).toContain("main");
    expect(render({ ...compose, managed: null })).not.toContain("Deploy on push");
    expect(render({ ...compose, managed: { kind: "image", image: "nginx:alpine" } })).not.toContain("Deploy on push");
  });

  it("points repo owners to Settings for automatic deploys", () => {
    const markup = renderToStaticMarkup(createElement(ComposeOverviewTab, { compose }));
    expect(markup).toContain("Enable deploy on push in Settings");
    expect(markup).not.toContain("pushes do not deploy automatically");
  });
});

describe("deployment commit labels", () => {
  it("renders the full commit title visibly and as a tooltip", () => {
    const title = "Deploy a1b2c3d · Fix header";
    const markup = renderToStaticMarkup(createElement(DeploymentHistory, {
      service: {
        ...compose,
        deployments: [{
          deploymentId: "deploy-1",
          status: "done",
          title,
          createdAt: "2026-10-25T10:00:00Z",
          finishedAt: "2026-10-25T10:01:00Z",
          errorMessage: null,
          rollbackId: null,
        }],
      },
    }));
    expect(markup).toContain(`title="${title}">${title}</div>`);
    expect(markup).toContain("Succeeded");
  });
});
