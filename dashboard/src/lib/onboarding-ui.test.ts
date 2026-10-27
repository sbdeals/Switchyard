import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ComposeService, ProjectNode } from "./dokploy";
import { GettingStarted } from "../components/GettingStarted";
import { QuickDeployMenu } from "../components/QuickDeployMenu";
import { Workspace } from "../components/Workspace";
import { ServiceDrawer } from "../components/service/ServiceDrawer";
import { DirtyGuardProvider } from "../components/DirtyGuard";
import { redactServiceForClient } from "./service-redaction";

// Keep these render tests local: server actions and unrelated drawer panels never run.
vi.mock("@/app/actions", () => ({
  quickDeployDatabaseAction: vi.fn(), quickDeployImageAction: vi.fn(), quickDeployRepoAction: vi.fn(),
  createComposeAction: vi.fn(), listTemplatesAction: vi.fn(), quickDeployTemplateAction: vi.fn(),
  lifecycleAction: vi.fn(), updateDatabaseAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/engines", async () => import("./engines"));
vi.mock("@/lib/onboarding", async () => import("./onboarding"));
vi.mock("@/lib/service-meta", async () => import("./service-meta"));
vi.mock("@/lib/utils", async () => import("./utils"));
vi.mock("@/lib/connection", () => ({ connectionString: () => null }));
vi.mock("@/components/use-focus-trap", () => ({ useDialogFocus: () => undefined }));
vi.mock("@/components/QuickDeployMenu", async () => import("../components/QuickDeployMenu"));
vi.mock("@/components/GettingStarted", async () => import("../components/GettingStarted"));
vi.mock("@/components/service/ServiceDrawer", async () => import("../components/service/ServiceDrawer"));
vi.mock("@/components/GithubDeployModal", () => ({ GithubDeployModal: () => null }));
vi.mock("@/components/ProjectsPanel", () => ({ ProjectsPanel: () => null }));
vi.mock("@/components/agent/AgentPanel", () => ({ AgentPanel: () => null }));
vi.mock("@/components/ServiceCard", () => ({ ServiceCard: () => null }));
vi.mock("@/components/canvas/FlowCanvas", () => ({ FlowCanvas: () => "Service canvas" }));
vi.mock("@/components/StatusBadge", () => ({ StatusBadge: () => null }));
vi.mock("@/components/service/VariablesTab", () => ({ VariablesTab: () => "Variables panel" }));
vi.mock("@/components/service/BackupsTab", () => ({ BackupsTab: () => null }));
vi.mock("@/components/service/VolumesTab", () => ({ VolumesTab: () => null }));
vi.mock("@/components/service/MetricsTab", () => ({ MetricsTab: () => null }));
vi.mock("@/components/service/LogsTab", () => ({ LogsTab: () => null }));
vi.mock("@/components/service/ConsoleTab", () => ({ ConsoleTab: () => null }));
vi.mock("@/components/service/DataTab", () => ({ DataTab: () => null }));
vi.mock("@/components/service/ConnectTab", () => ({ ConnectTab: () => null }));
vi.mock("@/components/service/networking", () => ({ NetworkingTab: () => "Networking panel" }));
vi.mock("@/components/service/AppTabs", () => ({
  AppOverviewTab: () => null, AppBuildTab: () => null, AppDeployTab: () => null,
  AppSettingsTab: () => null, DeploymentsTab: () => null, DeploymentHistory: () => null, SchedulesTab: () => null,
}));
vi.mock("@/components/service/ComposeTabs", () => ({
  ComposeOverviewTab: () => "Overview panel", ComposeEditorTab: () => null,
  ComposeDomainsTab: () => "Networking panel", ComposeSettingsTab: () => null,
}));
vi.mock("@/components/service/primitives", () => ({
  inputCls: "", Field: () => null, Info: () => null, CopyButton: () => null,
  LifecycleButtons: () => null, SaveRow: () => null, DangerZone: () => null,
  useLifecycle: vi.fn(), useSavedFlash: () => [false, vi.fn()],
}));

const project: ProjectNode = {
  projectId: "project-1", name: "First project",
  environments: [{ environmentId: "production", name: "Production" }],
};
const service: ComposeService = {
  kind: "compose", id: "service-1", name: "First service", appName: "first-service", status: "done",
  projectId: project.projectId, projectName: project.name, environmentId: "production", environmentName: "Production",
  dockerImage: null, env: null, createdAt: null, cpuLimit: null, memoryLimit: null, replicas: null,
  composeFile: null, composeType: null, domains: [], deployments: [],
};

describe("onboarding deployment entry points", () => {
  it("offers exactly three accessible card actions without opening a dialog", () => {
    const html = renderToStaticMarkup(createElement(QuickDeployMenu, { projects: [], onDeployed: vi.fn(), variant: "cards" }));
    expect(html.match(/<button\b/g)).toHaveLength(3);
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(3);
    expect(html).toContain("Deploy from GitHub repo");
    expect(html).toContain("Deploy a Docker image");
    expect(html).toContain("Add a database");
    expect(html).not.toContain('role="dialog"');
  });

  it("preserves the default New service menu and supports opening it from a checklist item", () => {
    const props = { projects: [], onDeployed: vi.fn() };
    const closed = renderToStaticMarkup(createElement(QuickDeployMenu, props));
    expect(closed.match(/<button\b/g)).toHaveLength(1);
    expect(closed).toContain("New service");
    const open = renderToStaticMarkup(createElement(QuickDeployMenu, { ...props, menuOpen: true }));
    expect(open).toContain('role="dialog"');
    expect(open).toContain('aria-label="Docker image"');
    expect(open).toContain('type="number" min="1" max="65535"');
    expect(open).toContain('aria-label="Git repository URL"');
    expect(open).toContain("PostgreSQL");
    expect(open).toContain("App catalog");
  });

  it("shows a focused image dialog with a service name field and a close control", () => {
    const html = renderToStaticMarkup(createElement(QuickDeployMenu, {
      projects: [], onDeployed: vi.fn(), variant: "cards", menuOpen: true,
    }));
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Close deployment dialog"');
    expect(html).toContain("Service name (optional)");
    expect(html).toContain('aria-label="Docker image"');
    expect(html).toContain('type="number" min="1" max="65535"');
    expect(html).not.toContain('aria-label="Git repository URL"');
    expect(html).not.toContain("PostgreSQL");
    expect(html).not.toContain("App catalog");
  });

  it("blocks every deploy source when an existing project has no environment", () => {
    const html = renderToStaticMarkup(createElement(QuickDeployMenu, {
      projects: [{ ...project, environments: [] }], onDeployed: vi.fn(), menuOpen: true,
    }));
    expect(html).toContain("Add an environment in Projects before deploying a service.");
    const buttons = html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
    const deployButtons = buttons.filter((button) => />(Deploy|From GitHub|Compose stack|PostgreSQL|MySQL|MariaDB|MongoDB|Redis)</.test(button));
    expect(deployButtons).toHaveLength(9);
    expect(deployButtons.every((button) => button.includes('disabled=""'))).toBe(true);
  });

  it("replaces an empty workspace canvas with onboarding actions, then restores the canvas when populated", () => {
    const props = { projects: [project], edges: [], userId: "hashed-user" };
    const empty = renderToStaticMarkup(createElement(Workspace, { ...props, services: [] }));
    expect(empty).toContain("Bring your first project to life");
    expect(empty).toContain("Deploy a Docker image");
    expect(empty).not.toContain("Service canvas");
    expect(empty).toContain("Logs</button>");
    expect(empty).toContain("Activity</button>");
    expect(empty).toContain('aria-label="Keyboard shortcuts"');
    const populated = renderToStaticMarkup(createElement(Workspace, { ...props, services: [service] }));
    expect(populated).toContain("Service canvas");
    expect(populated).not.toContain("Bring your first project to life");
    expect(populated).not.toContain("Deploy a Docker image");
  });
});

describe("getting-started card", () => {
  const props = { userId: "hashed-user", onNavigate: vi.fn() };

  it("renders five actionable milestones, a live progress count and dismissal for a new user", () => {
    const html = renderToStaticMarkup(createElement(GettingStarted, { ...props, projects: [], services: [] }));
    expect(html).toContain("0 of 5 complete");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Dismiss getting started"');
    for (const label of ["Create a project", "Deploy your first service", "Add a domain", "Set a variable", "Add a second environment"]) {
      expect(html).toContain(label);
    }
    expect(html.match(/To do: /g)).toHaveLength(5);
    expect(html.match(/<button\b/g)).toHaveLength(6);
  });

  it("updates both progress and accessible completion labels from workspace records", () => {
    const html = renderToStaticMarkup(createElement(GettingStarted, { ...props, projects: [project], services: [service] }));
    expect(html).toContain("2 of 5 complete");
    expect(html.match(/Complete: /g)).toHaveLength(2);
    expect(html.match(/To do: /g)).toHaveLength(3);
  });

  it("automatically hides after all milestones are complete", () => {
    const html = renderToStaticMarkup(createElement(GettingStarted, {
      ...props,
      projects: [{ ...project, environments: [...project.environments, { environmentId: "staging", name: "Staging" }] }],
      services: [redactServiceForClient({ ...service, env: "GREETING=hello", domains: [{ domainId: "domain-1", host: "example.test", https: false, port: 80, path: null, certificateType: "none", serviceName: "web" }] })],
    }));
    expect(html).toBe("");
  });
});

describe("checklist service destinations", () => {
  it.each([
    ["overview", "Overview panel"], ["variables", "Variables panel"], ["domains", "Networking panel"],
  ] as const)("opens the %s tab with its accessible selected state", (tab, content) => {
    const html = renderToStaticMarkup(createElement(DirtyGuardProvider, null,
      createElement(ServiceDrawer, {
        service, tab, sessionKey: `${service.id}:${tab}`, onTabChange: vi.fn(), onClose: vi.fn(),
      }),
    ));
    expect(html).toContain(`id="drawer-tab-${tab}" aria-selected="true"`);
    expect(html).toContain(`aria-labelledby="drawer-tab-${tab}"`);
    expect(html).toContain(content);
  });
});
