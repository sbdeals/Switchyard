import { describe, expect, it } from "vitest";
import { getServiceTabs, parseDeeplink, safeNextPath, serializeDeeplink } from "./deeplink";

const services = [
  { id: "app", kind: "application" as const },
  { id: "postgres", kind: "database" as const, engine: "postgres" },
  { id: "redis", kind: "database" as const, engine: "redis" },
  { id: "compose", kind: "compose" as const, composeFile: "services:\n  web:\n    image: nginx:alpine" },
  { id: "app /?&=雪", kind: "application" as const },
  { id: "pg-compose", kind: "compose" as const, composeFile: "services:\n  db:\n    image: postgres:16" },
  { id: "pg-image", kind: "database" as const, engine: "mysql", dockerImage: "postgres:16" },
];

describe("getServiceTabs", () => {
  it("preserves the application tabs and their order", () => {
    expect(getServiceTabs(services[0])).toEqual([
      "overview", "variables", "deploy", "build", "domains", "deployments", "schedules",
      "volumes", "metrics", "logs", "console", "settings",
    ]);
  });

  it("preserves database tabs and inserts Data after Overview for Postgres", () => {
    expect(getServiceTabs(services[2])).toEqual([
      "overview", "variables", "volumes", "metrics", "logs", "console", "backups", "settings",
    ]);
    expect(getServiceTabs(services[1])).toEqual([
      "overview", "data", "variables", "volumes", "metrics", "logs", "console", "backups", "settings",
    ]);
  });

  it("recognizes Postgres database images without changing application tabs", () => {
    expect(getServiceTabs({ ...services[2], dockerImage: "registry/PostgreSQL:16" })).toContain("data");
    expect(getServiceTabs({ ...services[0], dockerImage: "postgres:16" })).not.toContain("data");
  });

  it("preserves compose tabs", () => {
    expect(getServiceTabs(services[3])).toEqual([
      "overview", "variables", "domains", "deployments", "editor", "volumes", "metrics",
      "logs", "console", "settings",
    ]);
  });

  it.each([
    "services:\n  db:\n    image: postgres:16",
    "services:\n  db:\n    image: 'registry/Postgres:16'",
    'services:\n  db:\n    image: "postgres:16" # database',
  ])("inserts compose Data for a Postgres image: %s", (composeFile) => {
    expect(getServiceTabs({ ...services[3], composeFile }).slice(0, 3)).toEqual(["overview", "data", "variables"]);
  });

  it.each([null, "", "# image: postgres:16", "services:\n  postgres:\n    image: nginx # postgres"])(
    "ignores compose comments and service names: %s",
    (composeFile) => {
      expect(getServiceTabs({ ...services[3], composeFile })).not.toContain("data");
    },
  );

  it("returns fresh tab lists", () => {
    getServiceTabs(services[0]).push("data");
    expect(getServiceTabs(services[0])).not.toContain("data");
  });
});

describe("parseDeeplink", () => {
  it("defaults to a closed drawer", () => {
    expect(parseDeeplink("project=one", services)).toEqual({
      serviceId: null, tab: "overview", invalidService: false, invalidTab: false,
    });
  });

  it("defaults a known service to Overview when no tab is provided", () => {
    expect(parseDeeplink("?service=app", services)).toEqual({
      serviceId: "app", tab: "overview", invalidService: false, invalidTab: false,
    });
  });

  it.each(services)("accepts every supported tab for $id", (service) => {
    for (const tab of getServiceTabs(service)) {
      expect(parseDeeplink(new URLSearchParams({ service: service.id, tab }), services)).toEqual({
        serviceId: service.id, tab, invalidService: false, invalidTab: false,
      });
    }
  });

  it.each(["service=", "service=missing", "service=%20"])("closes a missing service: %s", (query) => {
    expect(parseDeeplink(query, services)).toEqual({
      serviceId: null, tab: "overview", invalidService: true, invalidTab: false,
    });
  });

  it.each(["tab=logs", "tab=", "service=missing&tab=logs"])("rejects an orphan tab: %s", (query) => {
    const result = parseDeeplink(query, services);
    expect(result.serviceId).toBeNull();
    expect(result.tab).toBe("overview");
    expect(result.invalidTab).toBe(true);
  });

  it.each([
    ["app", "backups"], ["app", "data"], ["redis", "data"], ["redis", "build"],
    ["compose", "data"], ["compose", "build"], ["postgres", "editor"],
    ["app", "unknown"], ["app", "LOGS"], ["app", ""],
  ])("falls back to Overview for unsupported %s tab %s", (service, tab) => {
    expect(parseDeeplink(new URLSearchParams({ service, tab }), services)).toEqual({
      serviceId: service, tab: "overview", invalidService: false, invalidTab: true,
    });
  });

  it("does not modify URLSearchParams input", () => {
    const query = new URLSearchParams("service=app&tab=logs&filter=active");
    parseDeeplink(query, services);
    expect(query.toString()).toBe("service=app&tab=logs&filter=active");
  });
});

describe("serializeDeeplink", () => {
  it("opens a service while preserving unrelated parameters", () => {
    expect(serializeDeeplink("project=one&filter=a&filter=b", "app", "logs"))
      .toBe("project=one&filter=a&filter=b&service=app&tab=logs");
  });

  it("replaces all previous service and tab parameters", () => {
    expect(serializeDeeplink("service=old&tab=logs&service=older&tab=build&project=one", "postgres", "data"))
      .toBe("project=one&service=postgres&tab=data");
  });

  it("omits the tab when it is not supplied", () => {
    expect(serializeDeeplink("service=app&tab=logs", "redis")).toBe("service=redis");
  });

  it.each([null, ""])("closes the drawer and removes the tab for %s", (serviceId) => {
    expect(serializeDeeplink("project=one&service=app&tab=logs", serviceId, "logs")).toBe("project=one");
    expect(serializeDeeplink("service=app&tab=logs", serviceId)).toBe("");
  });

  it("round-trips service ids with reserved characters and Unicode", () => {
    const query = serializeDeeplink("", services[4].id, "logs");
    expect(query).toBe("service=app+%2F%3F%26%3D%E9%9B%AA&tab=logs");
    expect(parseDeeplink(query, services)).toEqual({
      serviceId: services[4].id, tab: "logs", invalidService: false, invalidTab: false,
    });
  });

  it("does not modify URLSearchParams input", () => {
    const query = new URLSearchParams("service=app&tab=logs");
    serializeDeeplink(query, null);
    expect(query.toString()).toBe("service=app&tab=logs");
  });
});

describe("safeNextPath", () => {
  it.each(["/", "/?service=app&tab=logs", "/projects/demo?tab=overview#service", "/?next=https%3A%2F%2Fexample.com"])(
    "preserves local path %s",
    (path) => expect(safeNextPath(path)).toBe(path),
  );

  it.each([
    undefined, null, 1, {}, [], "", "app", "?service=app", "https://example.com/", "http://example.com/",
    "javascript:alert(1)", "//example.com/", "///example.com/", "/\\example.com/", "\\/example.com/",
    "/path\\file", " /path", "/\n/example.com", "/\r/example.com", "/\t/example.com", "/\0path", "/\u007fpath",
  ])("rejects an unsafe next path: %j", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});
