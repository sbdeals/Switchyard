import { describe, expect, it, vi } from "vitest";
import type { ComposeService } from "@/lib/dokploy";
import { bindServiceActions } from "@/lib/service-actions";

const service: ComposeService = {
  kind: "compose", id: "web-1", name: "web", appName: "web-abc", status: "done",
  projectId: "project-1", projectName: "Project", environmentId: "env-1", environmentName: "production",
  dockerImage: "nginx:alpine", env: "", createdAt: null, cpuLimit: null, memoryLimit: null,
  replicas: null, composeFile: null, composeType: "docker-compose", domains: [], deployments: [],
  managed: { kind: "image", image: "nginx:alpine" },
};
const handlers = () => ({
  onOpen: vi.fn(),
  run: vi.fn(),
  openUrl: vi.fn(),
  copyUrl: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn().mockReturnValue(true),
});

describe("shared service actions", () => {
  it("binds menu entries directly to the shared actions, including config children", () => {
    const { items, actions } = bindServiceActions(service, handlers());
    expect(items.find((item) => item.id === "config")?.onSelect).toBeUndefined();
    for (const item of items.filter((item) => item.id !== "config")) {
      expect(item.onSelect).toBe(actions[item.id as keyof typeof actions]);
    }
    expect(items[0].children?.map((item) => item.onSelect)).toEqual([actions.networking, actions.compose, actions.volumes]);
  });

  it("routes every drawer action to the existing section", () => {
    const callbacks = handlers();
    const { actions } = bindServiceActions(service, callbacks);
    const sections = {
      source: "build", networking: "domains", "deploy-settings": "deploy", compose: "editor",
      volumes: "volumes", backups: "backups", variables: "variables", metrics: "metrics",
      open: "overview", logs: "logs", settings: "settings",
    } as const;
    for (const action of Object.keys(sections) as (keyof typeof sections)[]) {
      actions[action]();
      expect(callbacks.onOpen).toHaveBeenLastCalledWith(sections[action]);
    }
    expect(callbacks.run).not.toHaveBeenCalled();
  });

  it("passes deploy, restart and stop through the existing lifecycle runner", () => {
    const callbacks = handlers();
    const { actions } = bindServiceActions(service, callbacks);
    actions.deploy();
    actions.restart();
    actions.stop();
    expect(callbacks.run.mock.calls).toEqual([["deploy"], ["restart"], ["stop"]]);
    expect(callbacks.confirm).not.toHaveBeenCalled();
  });

  it("preserves the delete confirmation and only removes on acceptance", () => {
    const callbacks = handlers();
    const { items } = bindServiceActions(service, callbacks);
    const remove = items.find((item) => item.id === "delete")!;
    expect(remove.destructive).toBe(true);
    callbacks.confirm.mockReturnValueOnce(false);
    remove.onSelect?.();
    expect(callbacks.confirm).toHaveBeenCalledWith('Destroy "web"? This cannot be undone.');
    expect(callbacks.run).not.toHaveBeenCalled();
    remove.onSelect?.();
    expect(callbacks.run.mock.calls).toEqual([["remove"]]);
  });

  it("opens and copies the same preferred URL, preserving clipboard failures", async () => {
    const callbacks = handlers();
    const domains = [
      { domainId: "http", host: "web.example.test", https: false, port: 80, path: null, certificateType: "none" as const, serviceName: "app" },
      { domainId: "https", host: "secure.example.test", https: true, port: 80, path: null, certificateType: "none" as const, serviceName: "app" },
    ];
    const { actions } = bindServiceActions({ ...service, domains }, callbacks);
    actions["open-url"]();
    await actions["copy-url"]();
    expect(callbacks.openUrl).toHaveBeenCalledWith("https://secure.example.test");
    expect(callbacks.copyUrl).toHaveBeenCalledWith("https://secure.example.test");
    callbacks.copyUrl.mockRejectedValueOnce(new Error("Clipboard denied"));
    await expect(actions["copy-url"]()).rejects.toThrow("Clipboard denied");
  });

  it("retains menu availability while a lifecycle action is pending", () => {
    const { items } = bindServiceActions(service, handlers(), true);
    expect(items.filter((item) => item.disabledReason).map((item) => item.id)).toEqual(["deploy", "restart", "stop", "delete"]);
    expect(items.find((item) => item.id === "variables")?.disabledReason).toBeUndefined();
    expect(items.find((item) => item.id === "open-url")).toBeUndefined();
  });

  it("exposes no commands or target-dependent callbacks without a selected service", () => {
    const callbacks = handlers();
    const { items, actions } = bindServiceActions(null, callbacks);
    expect(items).toEqual([]);
    actions.variables();
    actions["open-url"]();
    actions["copy-url"]();
    actions.delete();
    expect(callbacks.onOpen).not.toHaveBeenCalled();
    expect(callbacks.openUrl).not.toHaveBeenCalled();
    expect(callbacks.copyUrl).not.toHaveBeenCalled();
    expect(callbacks.confirm).not.toHaveBeenCalled();
    expect(callbacks.run).not.toHaveBeenCalled();
  });
});
