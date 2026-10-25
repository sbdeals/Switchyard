import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ composeLifecycleAction: vi.fn(), rollbackDeploymentAction: vi.fn() }));
vi.mock("@/app/deploy-hook-actions", () => ({ getDeployHookAction: vi.fn(), updateDeployHookAction: vi.fn() }));
vi.mock("@/components/service/AppTabs", () => ({ DomainRow: () => null }));

import { DeployHookInstructions } from "@/components/service/DeployHookPanel";
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
