import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Application, ComposeService, Database, Service } from "./dokploy";
import { PortConflictWarning } from "@/components/service/PortConflictWarning";
import { NetworkingTab } from "@/components/service/networking";
import { ComposeEditorTab } from "@/components/service/ComposeTabs";
import { ServiceDrawer } from "@/components/service/ServiceDrawer";

// Render the real controls in Node, supplying draft field state without a DOM.
// Browser focus, navigation, and persistence are covered by the live proof.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: vi.fn((initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()]),
    useTransition: () => [false, (run: () => void) => run()],
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
    useId: () => "port-conflicts-test",
  };
});
vi.mock("@/app/actions", () => ({}));
vi.mock("@/app/db-connect-actions", () => ({}));
vi.mock("@/app/deploy-actions", () => ({ deployOptionsAction: vi.fn() }));
vi.mock("@/components/DirtyGuard", () => ({ useDirtyGuard: vi.fn(), DirtyGuardScope: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/use-focus-trap", () => ({ useDialogFocus: () => vi.fn() }));
vi.mock("@/components/service/primitives", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/service/primitives")>(),
  useLifecycle: () => ({ pending: false, error: null, run: vi.fn() }),
  useSavedFlash: () => [false, vi.fn()],
}));

type Element = ReactElement<Record<string, unknown>>;

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function component(node: ReactNode, name: string): Element {
  const found = elements(node).find((element) => typeof element.type === "function" && element.type.name === name);
  if (!found) throw new Error(`Missing ${name} in the public editor`);
  return found;
}

function draft(...values: unknown[]) {
  for (const value of values) vi.mocked(useState).mockReturnValueOnce([value, vi.fn()]);
}

function shallow(element: Element): ReactNode {
  return (element.type as (props: Record<string, unknown>) => ReactNode)(element.props);
}

const app = { kind: "application", id: "editing", name: "Editing app", ports: [] } as unknown as Application;
const owner = {
  ...app,
  id: "existing",
  name: "Existing app",
  ports: [{ portId: "mapping", publishedPort: 3072, targetPort: 80, protocol: "tcp", publishMode: "host" }],
} as Application;
const services: Service[] = [app, owner];
const onSelectService = vi.fn();

function appEditor(published: string, protocol = "tcp", target = "80") {
  const ports = component(NetworkingTab({ app, services, onSelectService }), "PortsSection");
  draft(published, target, protocol);
  return renderToStaticMarkup(shallow(ports));
}

function databaseEditor(externalPort: number | null, proposed: string) {
  const db = {
    kind: "database", id: "database", name: "Database", appName: "database",
    engine: "redis", dockerImage: "redis:7", externalPort, cpuLimit: null,
    memoryLimit: null, databasePassword: null, createdAt: null,
  } as Database;
  draft(650);
  const settings = component(ServiceDrawer({ service: db, services: [db, owner], onSelectService, tab: "settings", sessionKey: db.id, onTabChange: vi.fn(), onClose: vi.fn() }), "SettingsTab");
  draft(db.name, "7", proposed);
  return renderToStaticMarkup(shallow(settings));
}

function composeEditor(port: number) {
  const compose = { kind: "compose", id: "compose", composeFile: null } as ComposeService;
  draft(`services:\n  web:\n    ports:\n      - "${port}:80"\n`, "services: {}", null);
  return renderToStaticMarkup(createElement(ComposeEditorTab, { compose, services, onSelectService }));
}

beforeEach(() => {
  vi.mocked(useState).mockClear();
  onSelectService.mockClear();
});

describe("published port warning", () => {
  it("names every conflicting service and opens the selected drawer", () => {
    const select = vi.fn();
    const warning = PortConflictWarning({
      warnings: [{ port: 3072, protocol: "tcp", reserved: false, conflicts: [
        { serviceId: "first", serviceName: "First app" },
        { serviceId: "second/one", serviceName: "Second app" },
      ] }],
      onSelectService: select,
    });
    const html = renderToStaticMarkup(warning);
    expect(html).toContain('role="status"');
    expect(html).toContain("First app");
    expect(html).toContain("Second app");
    expect(html).toContain('href="#service-second%2Fone"');
    const link = elements(warning).filter((element) => element.type === "a")[1];
    const preventDefault = vi.fn();
    (link.props.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith("second/one");
  });

  it("shows a reserved-host warning without inventing another service", () => {
    const html = renderToStaticMarkup(createElement(PortConflictWarning, {
      warnings: [{ port: 3001, protocol: "tcp", conflicts: [], reserved: true }], onSelectService,
    }));
    expect(html).toContain("reserved on this host for the dashboard/Dokploy");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("other service may be stopped");
  });

  it("renders nothing when there are no warnings", () => {
    expect(renderToStaticMarkup(createElement(PortConflictWarning, { warnings: [], onSelectService }))).toBe("");
  });
});

describe("port editor confirmation labels", () => {
  it("requires Save anyway for an app conflict and restores Add for another protocol", () => {
    const conflict = appEditor("3072");
    expect(conflict).toContain("Save anyway</button>");
    expect(conflict).toContain("Existing app");
    const udp = appEditor("3072", "udp");
    expect(udp).toContain("Add</button>");
    expect(udp).not.toContain('role="status"');
  });

  it("warns about reserved app ports and permits a non-conflicting value normally", () => {
    expect(appEditor("3000")).toContain("Save anyway</button>");
    const free = appEditor("3073");
    expect(free).toContain("Add</button>");
    expect(free).not.toContain('role="status"');
  });

  it("disables saving an out-of-range published or target port", () => {
    for (const html of [appEditor("65536"), appEditor("3073", "tcp", "0")]) {
      expect(html).toContain("Use ports from 1 to 65535.");
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Add<\/button>/);
    }
  });

  it("requires database confirmation only when the external port changes", () => {
    expect(databaseEditor(null, "3072")).toContain("Save anyway</button>");
    const unchanged = databaseEditor(3072, "3072");
    expect(unchanged).toContain("Save changes</button>");
    expect(unchanged).not.toContain('role="status"');
    const cleared = databaseEditor(3072, "");
    expect(cleared).toContain("Save changes</button>");
    expect(cleared).not.toContain('role="status"');
  });

  it("marks both compose save paths and restores their labels for a free port", () => {
    const conflict = composeEditor(3072);
    expect(conflict).toContain("Save anyway</button>");
    expect(conflict).toContain("Save anyway &amp; deploy</button>");
    expect(conflict).toContain("Existing app");
    const free = composeEditor(3073);
    expect(free).toContain("Save</button>");
    expect(free).toContain("Save &amp; deploy</button>");
    expect(free).not.toContain('role="status"');
  });
});
