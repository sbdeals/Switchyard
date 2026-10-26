import { describe, expect, it } from "vitest";
import { createDirtyRegistry, decideDirtyNavigation, discardMessage, hasDirtyFields } from "./dirty-guard";

describe("dirty registry", () => {
  it("tracks dirty forms and removes saved or reverted forms from the warning", () => {
    const registry = createDirtyRegistry();
    registry.set("variables", "Variables", false);
    expect(registry.labels()).toEqual([]);

    registry.set("variables", "Variables", true);
    expect(registry.labels()).toEqual(["Variables"]);

    registry.set("variables", "Variables", false);
    expect(registry.labels()).toEqual([]);
  });

  it("preserves registration order when forms become dirty", () => {
    const registry = createDirtyRegistry();
    registry.set("source", "Build", false);
    registry.set("resources", "Settings", true);
    registry.set("source", "Build", true);
    expect(registry.labels()).toEqual(["Build", "Settings"]);
  });

  it("deduplicates labels without losing another dirty form in the same tab", () => {
    const registry = createDirtyRegistry();
    registry.set("health", "Settings", true);
    registry.set("resources", "Settings", true);
    registry.set("domains", "Domains", true);
    expect(registry.labels()).toEqual(["Settings", "Domains"]);

    registry.set("health", "Settings", false);
    expect(registry.labels()).toEqual(["Settings", "Domains"]);

    registry.remove("resources");
    expect(registry.labels()).toEqual(["Domains"]);
  });

  it("removes unmounted forms and allows a fresh registration with the same key", () => {
    const registry = createDirtyRegistry();
    registry.set("editor", "Compose", true);
    registry.remove("editor");
    registry.remove("missing");
    expect(registry.labels()).toEqual([]);

    registry.set("editor", "Variables", false);
    expect(registry.labels()).toEqual([]);
    registry.set("editor", "Variables", true);
    expect(registry.labels()).toEqual(["Variables"]);
  });

  it("clears discarded forms so a new destination has no stale registrations", () => {
    const registry = createDirtyRegistry();
    registry.set("old-form", "Variables", true);
    registry.set("old-clean-form", "Settings", false);
    registry.clear();
    expect(registry.labels()).toEqual([]);

    registry.set("new-form", "Compose", true);
    registry.set("old-clean-form", "Settings", true);
    expect(registry.labels()).toEqual(["Compose", "Settings"]);
  });
});

describe("dirty navigation decisions", () => {
  it("proceeds immediately when every form is clean", () => {
    expect(decideDirtyNavigation([], false)).toBe("proceed");
  });

  it("asks once before abandoning any dirty form", () => {
    expect(decideDirtyNavigation(["Variables"], false)).toBe("confirm");
    expect(decideDirtyNavigation(["Build", "Settings"], false)).toBe("confirm");
  });

  it("ignores navigation to the current destination", () => {
    expect(decideDirtyNavigation([], false, true)).toBe("ignore");
    expect(decideDirtyNavigation(["Variables"], false, true)).toBe("ignore");
  });

  it("ignores repeated navigation while a decision is pending", () => {
    expect(decideDirtyNavigation([], true)).toBe("ignore");
    expect(decideDirtyNavigation(["Variables"], true)).toBe("ignore");
  });
});

describe("discard message", () => {
  it("names the dirty tab", () => {
    expect(discardMessage(["Variables"])).toBe("Discard unsaved changes in Variables?");
  });

  it("includes every dirty tab in one prompt", () => {
    expect(discardMessage(["Build", "Settings"])).toBe("Discard unsaved changes in Build, Settings?");
  });

  it("has a generic fallback when no label is supplied", () => {
    expect(discardMessage([])).toBe("Discard unsaved changes?");
  });
});

describe("dirty form fields", () => {
  const newDomain = {
    host: "",
    port: 80,
    https: true,
    certificateType: "letsencrypt",
    path: "/",
  };

  it("starts a domain creation form pristine", () => {
    expect(hasDirtyFields({ ...newDomain }, newDomain)).toBe(false);
  });

  it.each([
    ["host", { host: "app.example.com" }],
    ["port", { port: 8080 }],
    ["HTTPS", { https: false }],
    ["certificate", { certificateType: "none" }],
    ["path", { path: "/api" }],
  ])("detects a changed domain %s", (_field, change) => {
    expect(hasDirtyFields({ ...newDomain, ...change }, newDomain)).toBe(true);
  });

  it("clears a domain draft after resetting to its defaults", () => {
    let draft = { ...newDomain, host: "app.example.com", port: 8080 };
    expect(hasDirtyFields(draft, newDomain)).toBe(true);
    draft = { ...newDomain };
    expect(hasDirtyFields(draft, newDomain)).toBe(false);
  });

  it("keeps an unchanged existing domain clean regardless of field order", () => {
    const existing = { ...newDomain, host: "app.example.com", port: 8080 };
    const draft = {
      path: "/",
      https: true,
      certificateType: "letsencrypt",
      port: 8080,
      host: "app.example.com",
    };
    expect(hasDirtyFields(draft, existing)).toBe(false);
    expect(hasDirtyFields({ ...draft, https: false }, existing)).toBe(true);
  });

  it("tracks all fields of the compose domain form", () => {
    const defaults = { host: "", serviceName: "web", port: "80" };
    expect(hasDirtyFields({ ...defaults }, defaults)).toBe(false);
    expect(hasDirtyFields({ ...defaults, host: "app.example.com" }, defaults)).toBe(true);
    expect(hasDirtyFields({ ...defaults, serviceName: "api" }, defaults)).toBe(true);
    expect(hasDirtyFields({ ...defaults, port: "8080" }, defaults)).toBe(true);
  });

  it("accepts the submitted compose target as the next baseline", () => {
    const initial = { host: "", serviceName: "web", port: "80" };
    const submitted = { host: "app.example.com", serviceName: "api", port: "8080" };
    expect(hasDirtyFields(submitted, initial)).toBe(true);

    const afterSave = { ...submitted, host: "" };
    expect(hasDirtyFields(afterSave, { ...afterSave })).toBe(false);
    expect(hasDirtyFields({ ...afterSave, host: "next.example.com" }, afterSave)).toBe(true);
  });
});
