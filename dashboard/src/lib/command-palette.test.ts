import { describe, expect, it, vi } from "vitest";
import type { ComposeService, ProjectNode } from "@/lib/dokploy";
import { serviceMenuItems, workspaceMenuItems } from "@/lib/context-menu";
import { buildCommandRegistry, filterCommands, isPaletteShortcut, paletteKeyResult, recordRecentCommand, type PaletteCommand } from "@/lib/command-palette";

const service: ComposeService = {
  kind: "compose", id: "web-1", name: "web", appName: "web-abc", status: "done",
  projectId: "project-1", projectName: "Store", environmentId: "env-1", environmentName: "production",
  dockerImage: "nginx:alpine", env: "", createdAt: null, cpuLimit: null, memoryLimit: null,
  replicas: null, composeFile: null, composeType: "docker-compose", domains: [], deployments: [],
  managed: { kind: "image", image: "nginx:alpine" },
};
const project: ProjectNode = { projectId: "project-1", name: "Store", environments: [{ environmentId: "env-1", name: "production" }] };
const command = (id: string, label = id, extra: Partial<PaletteCommand> = {}): PaletteCommand => ({ id, label, section: "Navigate", run: vi.fn(), ...extra });
const ids = (commands: PaletteCommand[]) => commands.map(({ id }) => id);
const options = () => ({
  services: [service], projects: [project], focusedService: service,
  onOpenService: vi.fn(), onOpenProject: vi.fn(), onCreate: vi.fn(),
});

describe("command registry", () => {
  it("navigates to the projects overview, each project and the exact service", () => {
    const callbacks = options();
    const commands = buildCommandRegistry(callbacks);
    commands.find(({ id }) => id === "navigate:projects")!.run();
    commands.find(({ id }) => id === "navigate:project:project-1")!.run();
    commands.find(({ id }) => id === "navigate:service:web-1")!.run();
    expect(callbacks.onOpenProject.mock.calls).toEqual([[], ["project-1"]]);
    expect(callbacks.onOpenService).toHaveBeenCalledExactlyOnceWith(service);
    expect(filterCommands(commands, "web store production").map(({ label }) => label)).toEqual(["web"]);
  });

  it("uses service IDs to distinguish duplicate names and retain stable navigation after rename", () => {
    const commands = buildCommandRegistry({ ...options(), services: [service, { ...service, id: "web-2" }] });
    expect(ids(filterCommands(commands, "web"))).toEqual(["navigate:service:web-1", "navigate:service:web-2"]);
    const renamed = buildCommandRegistry({ ...options(), services: [{ ...service, name: "renamed" }] });
    expect(renamed.find(({ label }) => label === "renamed")!.id).toBe("navigate:service:web-1");
  });

  it("reuses bound context menu handlers, labels, availability and destructive flags", async () => {
    const bound = serviceMenuItems(service).map((item) => ({ ...item, onSelect: vi.fn() }));
    const commands = buildCommandRegistry({ ...options(), serviceItems: bound });
    const actions = commands.filter(({ section }) => section === "Actions");
    expect(actions.map(({ label }) => label)).toEqual(["View Variables", "View Settings", "View logs", "Redeploy", "Restart", "Stop", "Delete Service"]);
    for (const action of actions) {
      const original = bound.find(({ id }) => action.id === `action:web-1:${id}`)!;
      expect(action.run).toBe(original.onSelect);
      expect(action.destructive).toBe(original.destructive);
      await action.run();
      expect(original.onSelect).toHaveBeenCalledOnce();
    }
    const pending = serviceMenuItems(service, { pending: true }).map((item) => ({ ...item, onSelect: vi.fn() }));
    const blocked = buildCommandRegistry({ ...options(), serviceItems: pending }).find(({ id }) => id === "action:web-1:deploy")!;
    expect(blocked.disabledReason).toBe("An action is in progress.");
    expect(filterCommands([blocked], "redeploy")).toEqual([blocked]);
  });

  it("does not invent handlers, URLs or actions when no service is selected", () => {
    expect(buildCommandRegistry(options()).some(({ section }) => section === "Actions")).toBe(false);
    const bound = serviceMenuItems(service).map((item) => ({ ...item, onSelect: vi.fn() }));
    const withoutFocus = buildCommandRegistry({ ...options(), focusedService: null, serviceItems: bound });
    expect(withoutFocus.some(({ section }) => section === "Actions")).toBe(false);
    expect(ids(buildCommandRegistry({ ...options(), serviceItems: bound }))).not.toContain("action:web-1:open-url");
    const withUrl: ComposeService = { ...service, domains: [{ domainId: "d-1", host: "example.test", https: true, port: 80, path: "/", certificateType: "letsencrypt", serviceName: null }] };
    const urlItems = serviceMenuItems(withUrl).map((item) => ({ ...item, onSelect: vi.fn() }));
    expect(ids(buildCommandRegistry({ ...options(), focusedService: withUrl, serviceItems: urlItems }))).toContain("action:web-1:open-url");
  });

  it("changes service action IDs with the target so a recent action cannot retarget", () => {
    const bound = serviceMenuItems(service).map((item) => ({ ...item, onSelect: vi.fn() }));
    const commands = buildCommandRegistry({ ...options(), focusedService: { ...service, id: "web-2" }, serviceItems: bound });
    expect(filterCommands(commands, "redeploy", ["action:web-1:deploy"])).toMatchObject([{ id: "action:web-2:deploy", section: "Actions" }]);
  });

  it("mirrors every existing new-service entry and opens the general menu", () => {
    const callbacks = options();
    const create = buildCommandRegistry(callbacks).filter(({ section }) => section === "Create");
    expect(create.map(({ label }) => label)).toEqual(["New service", ...workspaceMenuItems().map(({ label }) => label)]);
    create.forEach(({ run }) => run());
    expect(callbacks.onCreate.mock.calls).toEqual([[], ...workspaceMenuItems().map(({ id }) => [id])]);
  });
});

describe("command filtering and ranking", () => {
  it("ranks exact, prefix, substring and fuzzy subsequence matches in that order", () => {
    const commands = [command("fuzzy", "Deep logs yesterday"), command("contains", "View deploy"), command("prefix", "Deployment logs"), command("exact", "Deploy")];
    expect(ids(filterCommands(commands, "deploy"))).toEqual(["exact", "prefix", "contains", "fuzzy"]);
  });

  it("puts an exact action ahead of weak navigation and recent matches", () => {
    const commands = [command("nav", "hc-predeploy-web"), command("recent", "hc-predeploy-worker"), command("action", "Redeploy", { section: "Actions" })];
    const filtered = filterCommands(commands, "redeploy", ["recent"]);
    expect(ids(filtered)).toEqual(["action", "recent", "nav"]);
    expect(filtered[0].section).toBe("Actions");
  });

  it("puts an exact create command ahead of a navigation substring", () => {
    const commands = [command("nav", "Old template catalog"), command("create", "Template", { section: "Create" })];
    expect(ids(filterCommands(commands, "template"))).toEqual(["create", "nav"]);
  });

  it("keeps sections contiguous while ranking each section by its strongest match", () => {
    const commands = [
      command("nav-substring", "View deploy"),
      command("action-fuzzy", "Deep logs yesterday", { section: "Actions" }),
      command("nav-prefix", "Deployment logs"),
      command("action-exact", "Deploy", { section: "Actions" }),
    ];
    expect(ids(filterCommands(commands, "deploy"))).toEqual(["action-exact", "action-fuzzy", "nav-prefix", "nav-substring"]);
  });

  it("uses the default section order to break equal search scores", () => {
    const commands = [command("create", "web", { section: "Create" }), command("action", "web", { section: "Actions" }), command("nav", "web"), command("recent", "web")];
    expect(ids(filterCommands(commands, "web", ["recent"]))).toEqual(["recent", "nav", "action", "create"]);
    expect(ids(filterCommands(commands, "", ["recent"]))).toEqual(["recent", "nav", "action", "create"]);
  });

  it("matches case and accents, trims repeated spaces and requires every token", () => {
    const commands = [command("cafe", "Café API", { description: "Store / production" }), command("wrong-env", "Cafe API", { description: "staging" })];
    expect(ids(filterCommands(commands, "  CAFE   api PRODUCTION  "))).toEqual(["cafe"]);
    expect(filterCommands(commands, "missing")).toEqual([]);
    expect(filterCommands(commands, "cafe nonexistent")).toEqual([]);
  });

  it("finds aliases without requiring tokens to be in the same field", () => {
    const commands = [command("vars", "View Variables", { description: "web", keywords: ["environment", "configuration"] })];
    expect(ids(filterCommands(commands, "web env config"))).toEqual(["vars"]);
  });

  it("preserves registry order for ties and does not mutate inputs", () => {
    const commands = [command("b", "web"), command("a", "web")];
    expect(ids(filterCommands(commands, "web"))).toEqual(["b", "a"]);
    expect(ids(filterCommands(commands, "  "))).toEqual(["b", "a"]);
    expect(ids(commands)).toEqual(["b", "a"]);
  });

  it("groups sections in a stable order with no duplicate recent rows", () => {
    const commands = [command("create", "Create", { section: "Create" }), command("action", "Deploy", { section: "Actions" }), command("nav"), command("recent")];
    const filtered = filterCommands(commands, "", ["recent", "recent", "missing"]);
    expect(filtered.map(({ id, section }) => [id, section])).toEqual([["recent", "Recent"], ["nav", "Navigate"], ["action", "Actions"], ["create", "Create"]]);
    expect(commands[3].section).toBe("Navigate");
  });

  it("limits valid recents to five and reuses current labels, handlers and disabled state", () => {
    const commands = Array.from({ length: 7 }, (_, i) => command(String(i)));
    commands[0] = command("0", "Fresh label", { disabledReason: "Busy" });
    const filtered = filterCommands(commands, "", ["stale", "0", "0", "1", "2", "3", "4", "5", "6"]);
    expect(ids(filtered.filter(({ section }) => section === "Recent"))).toEqual(["0", "1", "2", "3", "4"]);
    expect(filtered[0]).toMatchObject({ label: "Fresh label", disabledReason: "Busy", run: commands[0].run });
    expect(filterCommands(commands, "missing", ["0"])).toEqual([]);
  });

  it("records newest first, removes duplicates, caps history, and keeps inputs intact", () => {
    const previous = ["a", "b", "a", "c", "d", "e", "f"];
    expect(recordRecentCommand(previous, "c")).toEqual(["c", "a", "b", "d", "e"]);
    expect(previous).toEqual(["a", "b", "a", "c", "d", "e", "f"]);
  });
});

describe("palette keyboard", () => {
  const commands = [command("one"), command("disabled", "Disabled", { disabledReason: "Busy" }), command("three")];

  it("recognizes only unmodified Ctrl/Meta K, including uppercase keys", () => {
    expect(isPaletteShortcut({ key: "k", metaKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: "K", ctrlKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: "k" })).toBe(false);
    expect(isPaletteShortcut({ key: "s", ctrlKey: true })).toBe(false);
    for (const modifier of ["altKey", "shiftKey", "isComposing", "repeat"]) {
      expect(isPaletteShortcut({ key: "k", ctrlKey: true, [modifier]: true })).toBe(false);
    }
  });

  it("wraps arrow navigation, including disabled results for discoverability", () => {
    expect(paletteKeyResult({ key: "ArrowDown" }, 0, commands)).toEqual({ type: "focus", index: 1 });
    expect(paletteKeyResult({ key: "ArrowDown", repeat: true }, 2, commands)).toEqual({ type: "focus", index: 0 });
    expect(paletteKeyResult({ key: "ArrowUp" }, 0, commands)).toEqual({ type: "focus", index: 2 });
    expect(paletteKeyResult({ key: "ArrowDown" }, -1, commands)).toEqual({ type: "focus", index: 0 });
  });

  it("activates only an enabled result and ignores a held Enter", () => {
    expect(paletteKeyResult({ key: "Enter" }, 0, commands)).toEqual({ type: "activate", index: 0 });
    expect(paletteKeyResult({ key: "Enter" }, 1, commands)).toEqual({ type: "none" });
    expect(paletteKeyResult({ key: "Enter" }, -1, commands)).toEqual({ type: "none" });
    expect(paletteKeyResult({ key: "Enter", repeat: true }, 0, commands)).toEqual({ type: "none" });
  });

  it("closes empty results on Escape and never captures typing, cursor keys or modified keys", () => {
    expect(paletteKeyResult({ key: "Escape" }, 0, [])).toEqual({ type: "close" });
    expect(paletteKeyResult({ key: "ArrowDown" }, 0, [])).toEqual({ type: "none" });
    for (const key of ["d", "r", "v", " ", "Home", "End", "ArrowLeft", "ArrowRight"]) {
      expect(paletteKeyResult({ key }, 0, commands)).toEqual({ type: "none" });
    }
    for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey", "isComposing"]) {
      expect(paletteKeyResult({ key: "Enter", [modifier]: true }, 0, commands)).toEqual({ type: "none" });
    }
  });
});
