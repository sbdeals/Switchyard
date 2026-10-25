import { describe, expect, it, vi } from "vitest";
import type { Application, ComposeService, Database, Service, ServiceStatus } from "@/lib/dokploy";
import {
  deploymentMenuItems, destroyConfirmation, dismissAfterMenuFocusSettles, isContextMenuKey, menuKeyResult, menuPosition,
  prefersNativeContextMenu, projectMenuItems, runLifecycleAction, serviceMenuItems,
  servicePublicUrl, selectMenuService, shouldCloseMenu, submenuPosition, variableMenuItems, workspaceMenuItems,
} from "@/lib/context-menu";

const compose: ComposeService = {
  kind: "compose", id: "web-1", name: "web", appName: "web-abc", status: "done",
  projectId: "project-1", projectName: "Project", environmentId: "env-1", environmentName: "production",
  dockerImage: "nginx:alpine", env: "", createdAt: null, cpuLimit: null, memoryLimit: null,
  replicas: null, composeFile: null, composeType: "docker-compose", domains: [], deployments: [],
  managed: { kind: "image", image: "nginx:alpine" },
};
const ids = (items: { id: string }[]) => items.map((item) => item.id);
const item = (service: Service, id: string) => serviceMenuItems(service).find((entry) => entry.id === id)!;

describe("service menu items", () => {
  it("exposes all existing service operations, marks deletion, and omits an absent URL", () => {
    expect(ids(serviceMenuItems(compose))).toEqual(["config", "variables", "metrics", "settings", "open", "logs", "deploy", "restart", "stop", "delete"]);
    expect(item(compose, "delete")).toMatchObject({ label: "Delete Service", destructive: true, separatorBefore: true });
    expect(destroyConfirmation('web "preview"')).toBe('Destroy "web "preview""? This cannot be undone.');
  });

  it("keeps the reference ordering, separates operational extras, and omits unsupported grouping and duplication", () => {
    const items = serviceMenuItems(compose);
    expect(items.slice(0, 4).map((entry) => entry.label)).toEqual(["Config", "View Variables", "View Metrics", "View Settings"]);
    expect(items.filter((entry) => entry.separatorBefore).map((entry) => entry.id)).toEqual(["open", "delete"]);
    expect(ids(items)).not.toContain("group");
    expect(ids(items)).not.toContain("duplicate");
  });

  it("only exposes config destinations present in each service's drawer", () => {
    const app = { ...compose, kind: "application", sourceType: "docker" } as unknown as Application;
    const db = { ...compose, kind: "database", engine: "postgres" } as unknown as Database;
    expect(item(app, "config").children?.map((entry) => entry.label)).toEqual(["Source", "Networking", "Deploy", "Volumes"]);
    expect(item({ ...app, sourceType: "git" }, "config").children?.map((entry) => entry.label)).toEqual(["Build", "Networking", "Deploy", "Volumes"]);
    expect(item(compose, "config").children?.map((entry) => entry.label)).toEqual(["Networking", "Compose", "Volumes"]);
    expect(item(db, "config").children?.map((entry) => entry.label)).toEqual(["Volumes", "Backups"]);
    for (const service of [app, compose, db]) expect(ids(serviceMenuItems(service))).toContain("metrics");
  });

  it("keeps denied config destinations visible and disabled", () => {
    const items = serviceMenuItems(compose, { permissions: { config: false, networking: "Networking is read-only." } });
    expect(items[0].disabledReason).toContain("permission");
    expect(items[0].children?.find((entry) => entry.id === "networking")?.disabledReason).toBe("Networking is read-only.");
  });

  it("selects the context target exclusively without mutating positions or existing nodes", () => {
    const nodes = [{ id: "old", selected: true, position: { x: 1, y: 2 } }, { id: "target", selected: false, position: { x: 3, y: 4 } }];
    const selected = selectMenuService(nodes, "target");
    expect(selected.map((node) => node.selected)).toEqual([false, true]);
    expect(selected[1].position).toBe(nodes[1].position);
    expect(nodes.map((node) => node.selected)).toEqual([true, false]);
  });

  it.each(["idle", "running", "done", "error"] as ServiceStatus[])("uses status %s for lifecycle availability", (status) => {
    const service = { ...compose, status };
    expect(item(service, "deploy").label).toBe(status === "idle" ? "Deploy" : "Redeploy");
    expect(!!item(service, "restart").disabledReason).toBe(status !== "done");
    expect(!!item(service, "stop").disabledReason).toBe(status !== "done");
    expect(!!item(service, "deploy").disabledReason).toBe(status === "running");
  });

  it("offers Redeploy for stopped containers and does not offer Restart for missing containers", () => {
    const runtime = { total: 1, running: 0, health: "not-running" as const };
    expect(item({ ...compose, status: "idle", runtime }, "deploy").label).toBe("Redeploy");
    expect(item({ ...compose, runtime: { ...runtime, total: 0 } }, "restart").disabledReason).toBeTruthy();
  });

  it("mirrors the managed-repo in-flight guard and pinned redeploy label", () => {
    const service: ComposeService = { ...compose, status: "running", managed: { kind: "repo", image: "web:latest", pinnedTag: "web:saved", repoUrl: "https://example.com/web.git", branch: "release" } };
    expect(item(service, "deploy")).toMatchObject({ label: "Redeploy latest from release", disabledReason: "A deployment is in progress." });
    expect(item(service, "delete").disabledReason).toBeUndefined();
    expect(item({ ...service, managed: null }, "deploy").disabledReason).toBeUndefined();
  });

  it("disables pending mutations but leaves navigation and copying available", () => {
    const items = serviceMenuItems(compose, { pending: true });
    expect(items.filter((entry) => entry.disabledReason).map((entry) => entry.id)).toEqual(["deploy", "restart", "stop", "delete"]);
  });

  it("keeps denied actions visible, with explicit reasons overriding status reasons", () => {
    const items = serviceMenuItems({ ...compose, status: "idle" }, { permissions: { deploy: false, restart: "Only project owners can restart.", delete: false, logs: false } });
    expect(ids(items)).toEqual(ids(serviceMenuItems(compose)));
    expect(items.find((entry) => entry.id === "deploy")?.disabledReason).toContain("permission");
    expect(items.find((entry) => entry.id === "restart")?.disabledReason).toBe("Only project owners can restart.");
    expect(items.find((entry) => entry.id === "logs")?.disabledReason).toContain("permission");
    expect(items.find((entry) => entry.id === "delete")).toMatchObject({ destructive: true, disabledReason: expect.any(String) });
  });

  it("only includes Copy URL for public services and prefers HTTPS", () => {
    const domains = [
      { domainId: "http", host: "web.example.test", https: false, port: 80, path: null, certificateType: "none" as const, serviceName: "app" },
      { domainId: "https", host: "secure.example.test", https: true, port: 80, path: null, certificateType: "letsencrypt" as const, serviceName: "app" },
    ];
    const service = { ...compose, domains };
    expect(servicePublicUrl(service)).toBe("https://secure.example.test");
    expect(ids(serviceMenuItems(service))).toContain("copy-url");
    expect(ids(serviceMenuItems(service)).slice(4, 8)).toEqual(["open", "open-url", "copy-url", "logs"]);
    expect(servicePublicUrl({ ...service, domains: domains.slice(0, 1) })).toBe("http://web.example.test");
    expect(servicePublicUrl({ ...service, managed: null })).toBe("https://secure.example.test");
    expect(servicePublicUrl({ ...service, managed: { kind: "database", engine: "postgres", image: "postgres:17" } })).toBeNull();
    // These builders only inspect the common service fields plus domains.
    const app = { ...service, kind: "application" } as unknown as Application;
    const db = { ...compose, kind: "database", engine: "postgres" } as unknown as Database;
    expect(ids(serviceMenuItems(app))).toContain("copy-url");
    expect(ids(serviceMenuItems(db))).not.toContain("copy-url");
    expect(ids(serviceMenuItems(db))).not.toContain("open-url");
  });
});

describe("row and background menu items", () => {
  it("only offers rollback when an existing rollback is available", () => {
    expect(ids(deploymentMenuItems({ rollbackAvailable: false }))).toEqual(["logs", "redeploy", "copy-id"]);
    expect(ids(deploymentMenuItems({ rollbackAvailable: true }))).toEqual(["logs", "redeploy", "rollback", "copy-id"]);
    expect(deploymentMenuItems({ rollbackAvailable: true, pending: true })[2].disabledReason).toBeTruthy();
    expect(deploymentMenuItems({ rollbackAvailable: true, permissions: { rollback: false } })[2].disabledReason).toContain("permission");
  });

  it("groups rollback and copy below logs/redeploy, preserving service redeploy guards", () => {
    for (const rollbackAvailable of [false, true]) {
      const items = deploymentMenuItems({ rollbackAvailable, redeployDisabledReason: "A deployment is in progress." });
      expect(items.slice(0, 2).map((entry) => entry.label)).toEqual(["View logs", "Redeploy"]);
      expect(items.filter((entry) => entry.separatorBefore).map((entry) => entry.id)).toEqual([rollbackAvailable ? "rollback" : "copy-id"]);
      expect(items[1]).toMatchObject({ disabledReason: "A deployment is in progress.", description: "Redeploy the service's current configuration." });
      expect(items[0].disabledReason).toBeUndefined();
    }
    expect(deploymentMenuItems({ rollbackAvailable: false, permissions: { redeploy: false } })[1].disabledReason).toContain("permission");
  });

  it("copies a variable template/reference and disables edits while saving or denied", () => {
    expect(variableMenuItems()[0].label).toBe("Copy value");
    expect(variableMenuItems({ reference: true })[0].label).toBe("Copy reference");
    const items = variableMenuItems({ pending: true });
    expect(items[0].disabledReason).toBeUndefined();
    expect(items.slice(1).every((entry) => !!entry.disabledReason)).toBe(true);
    expect(items[2].destructive).toBe(true);
    expect(variableMenuItems({ permissions: { copy: false, edit: false, delete: false } }).every((entry) => !!entry.disabledReason)).toBe(true);
  });

  it("only adds existing project actions and retains denied ones as disabled", () => {
    expect(ids(projectMenuItems({ canRename: false, canDelete: false }))).toEqual(["open"]);
    expect(ids(projectMenuItems({ canRename: true, canDelete: false }))).toEqual(["open", "rename"]);
    expect(ids(projectMenuItems({ canRename: false, canDelete: true }))).toEqual(["open", "delete"]);
    const items = projectMenuItems({ canRename: true, canDelete: true, pending: true });
    expect(items[0].disabledReason).toBeUndefined();
    expect(items.slice(1).every((entry) => !!entry.disabledReason)).toBe(true);
    expect(items[2].destructive).toBe(true);
    expect(projectMenuItems({ canRename: true, canDelete: true, permissions: { rename: false, delete: "Read-only project." } })[2].disabledReason).toBe("Read-only project.");
  });

  it("offers only supported New service flows in reference order", () => {
    expect(workspaceMenuItems().map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "github", label: "GitHub Repo" },
      { id: "template", label: "Template" },
      { id: "database", label: "Database" },
      { id: "image", label: "Docker Image" },
      { id: "empty", label: "Empty Service" },
    ]);
    expect(workspaceMenuItems({ github: false })[0].disabledReason).toContain("permission");
    expect(workspaceMenuItems()[4].description).toBe("Create an empty Compose stack.");
  });
});

describe("lifecycle dispatch", () => {
  it.each(["deploy", "start", "stop", "remove"] as const)("passes %s to the existing action once", async (action) => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    await expect(runLifecycleAction(action, run)).resolves.toEqual({ ok: true });
    expect(run.mock.calls).toEqual([[action]]);
  });

  it("waits for Stop before Start when restarting", async () => {
    let stopped: (result: { ok: true }) => void = () => {};
    const run = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { stopped = resolve; })).mockResolvedValue({ ok: true });
    const result = runLifecycleAction("restart", run);
    expect(run.mock.calls).toEqual([["stop"]]);
    stopped({ ok: true });
    await expect(result).resolves.toEqual({ ok: true });
    expect(run.mock.calls).toEqual([["stop"], ["start"]]);
  });

  it("does not start if Stop fails, and reports a Start failure", async () => {
    const failed = { ok: false, error: "Permission denied" };
    const stopFails = vi.fn().mockResolvedValue(failed);
    await expect(runLifecycleAction("restart", stopFails)).resolves.toEqual(failed);
    expect(stopFails.mock.calls).toEqual([["stop"]]);
    const startFails = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValue(failed);
    await expect(runLifecycleAction("restart", startFails)).resolves.toEqual(failed);
    expect(startFails.mock.calls).toEqual([["stop"], ["start"]]);
  });
});

describe("keyboard, positioning and dismissal", () => {
  const items = [{ id: "open", label: "Open" }, { id: "stop", label: "Stop", disabledReason: "Stopped" }, { id: "delete", label: "Delete" }];

  it("opens with Shift+F10 or ContextMenu, not plain F10", () => {
    expect(isContextMenuKey("F10", true)).toBe(true);
    expect(isContextMenuKey("ContextMenu", false)).toBe(true);
    expect(isContextMenuKey("F10", false)).toBe(false);
    expect(isContextMenuKey("Enter", true)).toBe(false);
  });

  it("wraps arrow focus, includes disabled items, and supports Home/End", () => {
    expect(menuKeyResult("ArrowDown", 0, items)).toEqual({ type: "focus", index: 1 });
    expect(menuKeyResult("ArrowDown", 2, items)).toEqual({ type: "focus", index: 0 });
    expect(menuKeyResult("ArrowUp", 0, items)).toEqual({ type: "focus", index: 2 });
    expect(menuKeyResult("ArrowDown", -1, items)).toEqual({ type: "focus", index: 0 });
    expect(menuKeyResult("Home", 2, items)).toEqual({ type: "focus", index: 0 });
    expect(menuKeyResult("End", 0, items)).toEqual({ type: "focus", index: 2 });
  });

  it.each(["Enter", " "])("activates enabled items with %s and blocks disabled or absent items", (key) => {
    expect(menuKeyResult(key, 0, items)).toEqual({ type: "activate", index: 0 });
    expect(menuKeyResult(key, 1, items)).toEqual({ type: "none" });
    expect(menuKeyResult(key, -1, items)).toEqual({ type: "none" });
    expect(menuKeyResult(key, 0, [])).toEqual({ type: "none" });
  });

  it("closes on Escape and Tab and ignores unrelated keys", () => {
    expect(menuKeyResult("Escape", 0, items)).toEqual({ type: "close" });
    expect(menuKeyResult("Tab", 0, items)).toEqual({ type: "close" });
    expect(menuKeyResult("x", 0, items)).toEqual({ type: "none" });
    expect(menuKeyResult("ArrowDown", 0, [])).toEqual({ type: "none" });
  });

  it.each(["ArrowRight", "Enter", " "])("opens an enabled submenu with %s instead of activating its parent", (key) => {
    const items = [{ id: "config", label: "Config", children: [{ id: "source", label: "Source" }] }];
    expect(menuKeyResult(key, 0, items)).toEqual({ type: "open-submenu", index: 0 });
    expect(menuKeyResult(key, 0, [{ ...items[0], disabledReason: "Read-only" }])).toEqual({ type: "none" });
  });

  it("ArrowLeft and Escape leave only the submenu, while Tab closes the whole menu", () => {
    expect(menuKeyResult("ArrowLeft", 0, items, true)).toEqual({ type: "close-submenu" });
    expect(menuKeyResult("Escape", 0, items, true)).toEqual({ type: "close-submenu" });
    expect(menuKeyResult("Tab", 0, items, true)).toEqual({ type: "close" });
    expect(menuKeyResult("ArrowLeft", 0, items)).toEqual({ type: "none" });
    expect(menuKeyResult("ArrowRight", 0, items)).toEqual({ type: "none" });
    expect(menuKeyResult("Escape", 0, items)).toEqual({ type: "close" });
  });

  it("navigates and activates within a submenu just like the root", () => {
    expect(menuKeyResult("ArrowDown", 2, items, true)).toEqual({ type: "focus", index: 0 });
    expect(menuKeyResult("Enter", 0, items, true)).toEqual({ type: "activate", index: 0 });
    expect(menuKeyResult("Enter", 1, items, true)).toEqual({ type: "none" });
  });

  it.each(["pointerdown", "focusin", "scroll", "wheel"] as const)("closes on outside %s, preserving interaction inside the menu", (event) => {
    expect(shouldCloseMenu(event, false)).toBe(true);
    expect(shouldCloseMenu(event, true)).toBe(false);
  });

  it("closes when the window blurs or resizes", () => {
    expect(shouldCloseMenu("blur", true)).toBe(true);
    expect(shouldCloseMenu("resize", true)).toBe(true);
  });

  it("keeps a menu open when a focus trap briefly restores its opener before re-arming", async () => {
    let inside = false;
    const dismiss = vi.fn();
    dismissAfterMenuFocusSettles(() => inside, dismiss);
    inside = true;
    await Promise.resolve();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("closes when focus settles outside the menu", async () => {
    const dismiss = vi.fn();
    dismissAfterMenuFocusSettles(() => false, dismiss);
    expect(dismiss).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("ignores queued focus checks after the menu unmounts", async () => {
    let inside: boolean | null = false;
    const dismiss = vi.fn();
    dismissAfterMenuFocusSettles(() => inside, dismiss);
    inside = null;
    await Promise.resolve();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("preserves native menus in editors, logs and text selections", () => {
    const ordinary = { editable: false, selection: false, nativeTarget: false };
    expect(prefersNativeContextMenu(ordinary)).toBe(false);
    for (const key of Object.keys(ordinary)) expect(prefersNativeContextMenu({ ...ordinary, [key]: true })).toBe(true);
  });

  it("uses pointer/item coordinates, clamping to the viewport including tiny viewports", () => {
    const size = { width: 180, height: 250 };
    const viewport = { width: 1000, height: 700 };
    expect(menuPosition({ x: 100, y: 200 }, size, viewport)).toEqual({ x: 100, y: 200 });
    expect(menuPosition({ x: 999, y: 699 }, size, viewport)).toEqual({ x: 812, y: 442 });
    expect(menuPosition({ x: -50, y: -40 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(menuPosition({ x: 100, y: 100 }, size, { width: 100, height: 100 })).toEqual({ x: 8, y: 8 });
  });

  it("places submenus beside their parent and flips them at the right viewport edge", () => {
    const size = { width: 180, height: 250 };
    const viewport = { width: 1000, height: 700 };
    expect(submenuPosition({ left: 100, right: 300, top: 100 }, size, viewport)).toEqual({ x: 304, y: 100 });
    expect(submenuPosition({ left: 800, right: 990, top: 650 }, size, viewport)).toEqual({ x: 616, y: 442 });
  });
});
