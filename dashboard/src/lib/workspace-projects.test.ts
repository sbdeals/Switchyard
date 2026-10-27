import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Service } from "./dokploy";
import { Workspace } from "../components/Workspace";
import { ProjectsPanel } from "../components/ProjectsPanel";
import { ServiceDrawer } from "../components/service/ServiceDrawer";

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  useServiceDeeplink: vi.fn(),
  navigate: vi.fn(),
  close: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/docker", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/docker")>()), listVolumeDiskUsage: vi.fn(async () => null) }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: mocks.useState,
  useMemo: <T,>(factory: () => T) => factory(),
  useCallback: <T,>(callback: T) => callback,
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: () => {},
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/use-service-deeplink", () => ({ useServiceDeeplink: mocks.useServiceDeeplink }));
vi.mock("@/components/DirtyGuard", () => ({
  DirtyGuardProvider: () => null,
  useGuardedNavigation: () => ({ navigate: mocks.navigate }),
}));
vi.mock("@/components/ServiceCard", () => ({ ServiceCard: () => null }));
vi.mock("@/components/QuickDeployMenu", () => ({ QuickDeployMenu: () => null }));
vi.mock("@/components/ProjectsPanel", () => ({ ProjectsPanel: () => null }));
vi.mock("@/components/canvas/FlowCanvas", () => ({ FlowCanvas: () => null }));
vi.mock("@/components/service/ServiceDrawer", () => ({ ServiceDrawer: () => null }));
vi.mock("@/components/agent/AgentPanel", () => ({ AgentPanel: () => null }));
vi.mock("@/components/use-workspace-polling", () => ({ useWorkspacePolling: (initial: unknown) => initial }));
vi.mock("@/components/DeployNotifications", () => ({ DeployNotifications: () => null }));
vi.mock("@/components/ActivityPanel", () => ({ ActivityPanel: () => null }));
vi.mock("@/components/KeyboardShortcuts", () => ({ KeyboardShortcuts: () => null }));
vi.mock("@/components/ProjectLogs", () => ({ ProjectLogs: () => null }));
vi.mock("@/components/BulkActionDialog", () => ({ BulkActionDialog: () => null }));

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as Element;
    return [element, ...elements(element.props.children)];
  });
}
const service = { id: "app", name: "app", appName: "app", status: "running", projectId: "project", kind: "application" } as Service;

function mount() {
  const states: unknown[] = [];
  let index = 0;
  let changed = false;
  const drawer = {
    service: service as Service | null,
    tab: "variables", scope: "editor-session", close: mocks.close,
    selectTab: vi.fn(), open: vi.fn(), onDeployed: vi.fn(), notFound: false,
  };
  mocks.useServiceDeeplink.mockReturnValue(drawer);
  mocks.useState.mockImplementation((initial: unknown) => {
    const key = index++;
    if (!(key in states)) states[key] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [states[key], (next: unknown) => {
      if (!Object.is(states[key], next)) changed = true;
      states[key] = next;
    }];
  });

  function render() {
    let tree: ReactNode;
    let renders = 0;
    do {
      if (++renders > 10) throw new Error("Workspace did not settle");
      index = 0;
      changed = false;
      const wrapper = Workspace({ services: [service], projects: [], graph: { edges: [], warnings: [] } });
      const content = wrapper.props.children;
      tree = content.type(content.props);
    } while (changed);
    const nodes = elements(tree);
    return {
      projects: nodes.find((node) => node.type === ProjectsPanel)!.props,
      serviceDrawer: nodes.find((node) => node.type === ServiceDrawer)!.props,
      openProjects: nodes.find((node) => node.type === "button" &&
        Children.toArray(node.props.children).includes(" Projects"))!.props.onClick as () => void,
    };
  }
  return { drawer, render };
}

beforeEach(() => vi.resetAllMocks());

describe("project settings in the deep-linked workspace", () => {
  it("retains the deep-linked service's project after closing and follows later service selection", () => {
    const ui = mount();
    expect(ui.render().projects.selectedProjectId).toBe("project");
    ui.drawer.service = null;
    expect(ui.render().projects.selectedProjectId).toBe("project");
    ui.drawer.service = { ...service, id: "other", projectId: "other-project" };
    expect(ui.render().projects.selectedProjectId).toBe("other-project");
    ui.drawer.service = null;
    expect(ui.render().projects.selectedProjectId).toBe("other-project");
  });

  it("opens Projects and closes the drawer only after guarded navigation proceeds", () => {
    const ui = mount();
    ui.render().openProjects();
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(ui.render().projects.open).toBe(false);
    expect(mocks.close).not.toHaveBeenCalled();

    // Keeping edits never calls the queued action; discarding invokes it.
    mocks.navigate.mock.calls[0][0]();
    expect(mocks.close).toHaveBeenCalledOnce();
    ui.drawer.service = null;
    expect(ui.render().projects).toMatchObject({ open: true, selectedProjectId: "project" });
  });

  it("keeps main's tab, session and navigation props on the service drawer", () => {
    const ui = mount();
    expect(ui.render().serviceDrawer).toMatchObject({
      service, tab: "variables", sessionKey: "editor-session",
      onTabChange: ui.drawer.selectTab, onClose: mocks.close,
    });
  });
});
