import { describe, expect, it } from "vitest";
import { createDirtyRegistry, decideDeeplinkNavigation, decideDirtyNavigation, discardMessage, hasDirtyFields } from "./dirty-guard";

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

  it("limits warnings to the active service while retaining the unscoped API", () => {
    const registry = createDirtyRegistry();
    registry.set("app-variables", "Variables", true, "app");
    registry.set("app-settings", "Settings", false, "app");
    registry.set("database-settings", "Settings", true, "database");
    registry.set("workspace", "Workspace", true);

    expect(registry.labels("app")).toEqual(["Variables"]);
    expect(registry.labels("database")).toEqual(["Settings"]);
    expect(registry.labels("missing")).toEqual([]);
    expect(registry.labels()).toEqual(["Variables", "Settings", "Workspace"]);
  });

  it("clears only a departed service's registrations, including clean forms", () => {
    const registry = createDirtyRegistry();
    registry.set("app-variables", "Variables", true, "app");
    registry.set("app-settings", "Settings", false, "app");
    registry.set("database-settings", "Settings", true, "database");
    registry.set("workspace", "Workspace", true);
    registry.removeScope("app");
    registry.removeScope("missing");

    expect(registry.labels("app")).toEqual([]);
    expect(registry.labels()).toEqual(["Settings", "Workspace"]);
    registry.set("app-variables", "Variables", false, "app");
    expect(registry.labels("app")).toEqual([]);
    registry.set("app-variables", "Variables", true, "app");
    registry.set("app-settings", "Settings", true, "app");
    expect(registry.labels("app")).toEqual(["Variables", "Settings"]);

    registry.clear();
    expect(registry.labels("app")).toEqual([]);
    expect(registry.labels("database")).toEqual([]);
    expect(registry.labels()).toEqual([]);
  });

  it("updates the scope when a registration is reused", () => {
    const registry = createDirtyRegistry();
    registry.set("editor", "Variables", true, "app");
    registry.set("editor", "Variables", true, "database");
    expect(registry.labels("app")).toEqual([]);
    expect(registry.labels("database")).toEqual(["Variables"]);
  });

  it("retains newly registered forms while pruning a previous selection", () => {
    const registry = createDirtyRegistry();
    registry.set("old-editor", "Variables", true, "application:app:variables:0");
    registry.set("new-editor", "Settings", true, "application:app:settings:0");
    registry.set("unscoped", "Workspace", true);
    registry.retainScope("application:app:settings:0");

    expect(registry.labels()).toEqual(["Settings"]);
    expect(registry.labels("application:app:variables:0")).toEqual([]);
    expect(registry.labels("application:app:settings:0")).toEqual(["Settings"]);
  });

  it("clears the registry when no selection remains or a fresh discard session starts", () => {
    const registry = createDirtyRegistry();
    registry.set("editor", "Variables", true, "application:app:variables:0");
    registry.retainScope("application:app:variables:1");
    expect(registry.labels()).toEqual([]);

    registry.set("editor", "Variables", true, "application:app:variables:1");
    registry.set("unscoped", "Workspace", true);
    registry.retainScope(null);
    expect(registry.labels()).toEqual([]);
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

describe("deeplink navigation decisions", () => {
  const services = [
    { id: "app", kind: "application" as const },
    { id: "database", kind: "database" as const, engine: "postgres" },
    { id: "compose", kind: "compose" as const },
  ];
  const current = "service=app&tab=variables";

  it.each([
    ["close", "", null, "overview"],
    ["tab", "service=app&tab=settings", "app", "settings"],
    ["service", "service=database&tab=data", "database", "data"],
  ])("confirms dirty %s navigation without restoring a URL that has not changed", (_name, query, serviceId, tab) => {
    expect(decideDeeplinkNavigation(current, query!, services, ["Variables"], false)).toEqual({
      decision: "confirm", restore: false,
      target: { serviceId, tab, invalidService: false, invalidTab: false },
    });
  });

  it.each(["", "service=app&tab=settings", "service=database&tab=data"])(
    "restores dirty Back/Forward navigation while awaiting confirmation: %s", (query) => {
      expect(decideDeeplinkNavigation(current, query, services, ["Variables"], false, true))
        .toMatchObject({ decision: "confirm", restore: true });
    },
  );

  it.each([false, true])("ignores repeated dirty navigation while pending (popstate=%s)", (popstate) => {
    expect(decideDeeplinkNavigation(current, "service=database", services, ["Variables"], true, popstate))
      .toMatchObject({ decision: "ignore", restore: popstate });
  });

  it("does not restore a pending clean navigation", () => {
    expect(decideDeeplinkNavigation(current, "service=database", services, [], true, true))
      .toMatchObject({ decision: "ignore", restore: false });
  });

  it.each([false, true])("ignores the same parsed destination without restoring it (pending=%s)", (pending) => {
    expect(decideDeeplinkNavigation(current, "project=two&tab=variables&service=app", services, ["Variables"], pending, true))
      .toMatchObject({ decision: "ignore", restore: false });
    expect(decideDeeplinkNavigation("service=app", "service=app&tab=overview", services, ["Variables"], pending, true))
      .toMatchObject({ decision: "ignore", restore: false });
  });

  it.each([
    "service=unknown", "service=deleted", "service=unowned", "service=", "service=%20", "service=%E0%A4%A",
  ])("repairs unknown, stale, unowned, or malformed service IDs without prompting when clean: %s", (query) => {
    expect(decideDeeplinkNavigation(current, query, services, [], false, true)).toEqual({
      decision: "repair", restore: false,
      target: { serviceId: null, tab: "overview", invalidService: true, invalidTab: false },
    });
    // While dirty, an invalid id must not silently close the open form.
    expect(decideDeeplinkNavigation(current, query, services, ["Variables"], false, false)).toEqual({
      decision: "confirm", restore: false,
      target: { serviceId: null, tab: "overview", invalidService: true, invalidTab: false },
    });
    expect(decideDeeplinkNavigation(current, query, services, ["Variables"], false, true))
      .toMatchObject({ decision: "confirm", restore: true });
    expect(decideDeeplinkNavigation(current, query, services, ["Variables"], true, true))
      .toMatchObject({ decision: "ignore", restore: true });
  });

  it("checks both destinations against the current signed-in service list", () => {
    const remainingServices = services.filter((service) => service.id !== "app");
    expect(decideDeeplinkNavigation(current, "service=app", remainingServices, [], false, true))
      .toMatchObject({ decision: "repair", restore: false, target: { serviceId: null } });
    // The current service vanished too: both destinations resolve to the closed
    // drawer, so even stale labels cannot require a discard confirmation.
    expect(decideDeeplinkNavigation(current, "service=app", remainingServices, ["Variables"], false, true))
      .toMatchObject({ decision: "repair", restore: false, target: { serviceId: null } });
    expect(decideDeeplinkNavigation(current, "", remainingServices, ["Variables"], false, true))
      .toMatchObject({ decision: "ignore", restore: false });
  });

  it.each([
    ["service=app&tab=backups", "app"],
    ["service=app&tab=unknown", "app"],
    ["service=app&tab=", "app"],
    ["service=database&tab=build", "database"],
    ["service=compose&tab=data", "compose"],
    ["tab=logs", null],
  ])("repairs an invalid tab to Overview without prompting when clean: %s", (query, serviceId) => {
    expect(decideDeeplinkNavigation(current, query!, services, [], false, true)).toEqual({
      decision: "repair", restore: false,
      target: { serviceId, tab: "overview", invalidService: false, invalidTab: true },
    });
    expect(decideDeeplinkNavigation(current, query!, services, ["Variables"], false, true))
      .toMatchObject({ decision: "confirm", restore: true, target: { serviceId, tab: "overview" } });
  });

  it("repairs an invalid tab silently when it resolves to the destination already shown", () => {
    expect(decideDeeplinkNavigation("service=app", "service=app&tab=bogus", services, ["Overview notes"], false, false))
      .toMatchObject({ decision: "repair", restore: false });
  });

  it.each(["", "service=app&tab=settings", "service=database&tab=data"])(
    "proceeds with clean navigation, including Back/Forward: %s", (query) => {
      for (const popstate of [false, true]) {
        expect(decideDeeplinkNavigation(current, query, services, [], false, popstate))
          .toMatchObject({ decision: "proceed", restore: false });
      }
    },
  );
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
