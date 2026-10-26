import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FeatureNotice,
  HostCapabilitiesPill,
  HostCapabilitiesProvider,
} from "@/components/HostCapabilities";
import {
  AppBuildTab,
  AppDeployTab,
  AppOverviewTab,
  AppSettingsTab,
  DeploymentHistory,
  DeploymentsTab,
  SchedulesTab,
} from "@/components/service/AppTabs";
import { ComposeOverviewTab } from "@/components/service/ComposeTabs";
import { ServiceCard } from "@/components/ServiceCard";
import type { Application, ComposeService } from "@/lib/dokploy";
import type { HostCapabilities, HostFeature } from "@/lib/host-capabilities";

// Server actions must never run or read host/session configuration in UI tests.
vi.mock("@/app/actions", () => ({}));

const app: Application = {
  kind: "application",
  id: "test-app",
  name: "host-capabilities-test",
  appName: "host-capabilities-test",
  status: "idle",
  projectId: "test-project",
  projectName: "Test",
  environmentId: "test-environment",
  environmentName: "Test",
  dockerImage: "nginx:alpine",
  env: null,
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: 1,
  sourceType: "docker",
  buildType: "dockerfile",
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
};

const compose: ComposeService = {
  ...app,
  kind: "compose",
  composeType: "docker-compose",
  composeFile: "services:\n  web:\n    image: nginx:alpine\n",
};

function render(mode: HostCapabilities["mode"], child: ReactElement, version: string | null = "v0.30.10") {
  return renderToStaticMarkup(createElement(HostCapabilitiesProvider, {
    capabilities: { mode, dokployVersion: version },
  }, child));
}

function button(html: string, label: string) {
  const result = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .find((match) => match[2].replace(/<[^>]*>/g, "").trim() === label);
  if (!result) throw new Error(`Missing visible button: ${label}`);
  return result[1];
}

const disabled = /\sdisabled=""/;
const unknownNotice = "Docker Swarm availability could not be verified. Actions remain enabled.";

describe("host capabilities UI", () => {
  it("renders a bridge pill and an accessible explanation of supported features", () => {
    const html = render("bridge", createElement(HostCapabilitiesPill));
    expect(html).toContain("Host: bridge mode");
    expect(html).toContain('aria-label="Host capabilities"');
    expect(html).toContain("Dokploy v0.30.10");
    expect(html).toContain("Docker Compose + templates");
    expect(html.match(/>Supported</g)).toHaveLength(1);
    expect(html.match(/>Needs Swarm</g)).toHaveLength(5);
  });

  it("renders a manager pill with all currently exposed features supported", () => {
    const html = render("swarm", createElement(HostCapabilitiesPill));
    expect(html).toContain("Host: Swarm");
    expect(html).toContain("This Docker engine is a Swarm manager.");
    expect(html.match(/>Supported</g)).toHaveLength(6);
    expect(html).not.toContain("Needs Swarm");
  });

  it("reports failed detection without incorrectly calling the host bridge mode", () => {
    const html = render("unknown", createElement(HostCapabilitiesPill), null);
    expect(html).toContain("Host: unknown");
    expect(html).toContain("Dokploy version unavailable");
    expect(html).toContain("Docker mode could not be read. Swarm support is unverified; actions remain enabled.");
    expect(html.match(/>Supported</g)).toHaveLength(1);
    expect(html.match(/>Unverified</g)).toHaveLength(5);
    expect(html).not.toContain("Needs Swarm");
    expect(html).not.toContain("bridge mode");
  });

  it.each(["bridge", "worker"] as const)("disables native deploy but preserves Compose deploy on %s hosts", (mode) => {
    const native = render(mode, createElement(AppOverviewTab, { app }));
    const stack = render(mode, createElement(ComposeOverviewTab, { compose }));
    expect(button(native, "Deploy")).toMatch(disabled);
    expect(native).toContain('role="note"');
    expect(button(stack, "Deploy")).not.toMatch(disabled);
    expect(stack).not.toContain('role="note"');
  });

  it.each<HostFeature>(["nativeApplication", "replicas", "swarmHealthcheck", "schedules", "s3Backups"])(
    "shows a neutral %s notice when detection fails",
    (feature) => {
      expect(render("unknown", createElement(FeatureNotice, { feature }))).toContain(unknownNotice);
    },
  );

  it("keeps native actions enabled when Docker mode cannot be verified", () => {
    const idle = render("unknown", createElement(AppOverviewTab, { app }));
    expect(button(idle, "Deploy")).not.toMatch(disabled);
    expect(idle).toContain(unknownNotice);
    const stopped = render("unknown", createElement(AppOverviewTab, { app: { ...app, status: "error" } }));
    expect(button(stopped, "Start")).not.toMatch(disabled);
    expect(button(stopped, "Redeploy")).not.toMatch(disabled);
    const card = render("unknown", createElement(ServiceCard, { service: app }));
    expect(button(card, "Deploy")).not.toMatch(disabled);
    const deploys = render("unknown", createElement(DeploymentsTab, {
      app: {
        ...app,
        sourceType: "git",
        deployments: [{ deploymentId: "deploy-1", status: "done", title: "Test deploy", createdAt: "2026-01-01T00:00:00Z", rollbackId: "rollback-1" }],
      },
    }));
    expect(button(deploys, "Disabled")).not.toMatch(disabled);
    expect(button(deploys, "Roll back")).not.toMatch(disabled);
    const stack = render("unknown", createElement(ComposeOverviewTab, { compose }));
    expect(button(stack, "Deploy")).not.toMatch(disabled);
    expect(stack).not.toContain('role="note"');
  });

  it("keeps native settings editable and shows a neutral notice when detection fails", () => {
    const runtime = render("unknown", createElement(AppDeployTab, { app }));
    expect(runtime.match(/<fieldset/g)).toHaveLength(3);
    expect(runtime).not.toContain('<fieldset disabled=""');
    expect(runtime).toContain(unknownNotice);
    const settings = render("unknown", createElement(AppSettingsTab, { app, onClose: () => {} }));
    expect(settings).not.toContain('<fieldset disabled=""');
    expect(settings).toContain(unknownNotice);
    const build = render("unknown", createElement(AppBuildTab, { app }));
    const toggles = [...build.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)];
    expect(toggles).toHaveLength(2);
    expect(toggles.every((match) => !disabled.test(match[0]))).toBe(true);
    expect(build).toContain(unknownNotice);
    const schedules = render("unknown", createElement(SchedulesTab, { app }));
    expect(schedules).toContain(unknownNotice);
    // The empty form still needs its required fields; host detection adds no block.
    expect(button(schedules, "Create")).not.toContain("title=");
  });

  it("preserves native deploy on Swarm and Stop on bridge while disabling native redeploy", () => {
    expect(button(render("swarm", createElement(AppOverviewTab, { app })), "Deploy")).not.toMatch(disabled);
    const running = render("bridge", createElement(AppOverviewTab, { app: { ...app, status: "done" } }));
    expect(button(running, "Stop")).not.toMatch(disabled);
    expect(button(running, "Redeploy")).toMatch(disabled);
    const stopped = render("bridge", createElement(AppOverviewTab, { app: { ...app, status: "error" } }));
    expect(button(stopped, "Start")).toMatch(disabled);
  });

  it("guards native quick deploy on the service card while preserving Compose", () => {
    const native = render("bridge", createElement(ServiceCard, { service: app }));
    const stack = render("bridge", createElement(ServiceCard, { service: compose }));
    expect(button(native, "Deploy")).toMatch(disabled);
    expect(native).toContain("Use a Compose service instead.");
    expect(button(stack, "Deploy")).not.toMatch(disabled);
    const manager = render("swarm", createElement(ServiceCard, { service: app }));
    expect(button(manager, "Deploy")).not.toMatch(disabled);
  });

  it("keeps replicas, restart policy and healthcheck controls visible but disabled on bridge", () => {
    const html = render("bridge", createElement(AppDeployTab, { app }));
    for (const label of ["Replicas", "Restart policy", "Healthcheck", "Instances", "Test command"]) {
      expect(html).toContain(label);
    }
    expect(html.match(/<fieldset disabled=""/g)).toHaveLength(3);
    expect(html.match(/role="note"/g)).toHaveLength(3);
    const manager = render("swarm", createElement(AppDeployTab, { app }));
    expect(manager).not.toContain('<fieldset disabled=""');
    expect(manager).not.toContain('role="note"');
  });

  it("shows the application schedule notice and explains why creation is disabled", () => {
    const html = render("bridge", createElement(SchedulesTab, { app }));
    expect(html).toContain("New schedule");
    expect(html).toContain("Use a Compose service instead.");
    expect(button(html, "Create")).toMatch(disabled);
    expect(button(html, "Create")).toContain('title="Needs Docker Swarm');
    const manager = render("swarm", createElement(SchedulesTab, { app }));
    expect(manager).not.toContain('role="note"');
    expect(button(manager, "Create")).not.toContain("Needs Docker Swarm");
  });

  it("disables optional native redeploys while retaining build configuration fields", () => {
    const html = render("bridge", createElement(AppBuildTab, { app }));
    const toggles = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((match) => match[0]);
    expect(toggles).toHaveLength(2);
    expect(toggles.every((toggle) => disabled.test(toggle))).toBe(true);
    expect(html).toContain("Image &amp; registry");
    expect(html).toContain("Redeploy now to apply");
    const manager = render("swarm", createElement(AppBuildTab, { app }));
    expect([...manager.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].every((match) => !disabled.test(match[0]))).toBe(true);
  });

  it("blocks resource redeploys while leaving app rename and deletion available", () => {
    const html = render("bridge", createElement(AppSettingsTab, { app, onClose: () => {} }));
    expect(html.match(/<fieldset disabled=""/g)).toHaveLength(1);
    expect(html).toContain("CPU reservation");
    expect(button(html, `Destroy ${app.name}`)).not.toMatch(disabled);
    expect(html).toMatch(/<input[^>]*value="host-capabilities-test"/);
  });

  it("blocks native rollback on bridge and preserves it on Swarm", () => {
    const deployments = [{ deploymentId: "deploy-1", status: "done", title: "Test deploy", createdAt: "2026-01-01T00:00:00Z", rollbackId: "rollback-1" }];
    const native = render("bridge", createElement(DeploymentHistory, { deployments, application: true }));
    const manager = render("swarm", createElement(DeploymentHistory, { deployments, application: true }));
    expect(button(native, "Roll back")).toMatch(disabled);
    expect(button(manager, "Roll back")).not.toMatch(disabled);
  });

  it("blocks enabling native auto-deploy but allows disabling an existing configuration", () => {
    const gitApp = { ...app, sourceType: "git" as const };
    const disabledAutoDeploy = render("bridge", createElement(DeploymentsTab, { app: gitApp }));
    expect(button(disabledAutoDeploy, "Disabled")).toMatch(disabled);
    const enabledAutoDeploy = render("bridge", createElement(DeploymentsTab, { app: { ...gitApp, autoDeploy: true } }));
    expect(button(enabledAutoDeploy, "Enabled")).not.toMatch(disabled);
  });
});
