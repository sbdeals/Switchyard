import { describe, expect, it } from "vitest";
import type { Application, Service, ServiceRuntime, ServiceStatus } from "./dokploy";
import {
  filterServices,
  readServiceFilter,
  SERVICE_FILTERS,
  serviceFilterOpacity,
  serviceFilterShortcut,
  serviceFilterUrl,
  type ServiceFilterStatus,
} from "./service-filter";

function application(overrides: Partial<Application> = {}): Application {
  return {
    kind: "application", id: "web", name: "Storefront", appName: "shop-web-123",
    status: "done", projectId: "shop", projectName: "Commerce",
    environmentId: "prod", environmentName: "Production", dockerImage: "nginx:alpine",
    env: null, createdAt: null, cpuLimit: null, memoryLimit: null, replicas: null,
    sourceType: "git", buildType: null, description: null, repository: "acme/catalog",
    dockerfile: null, dockerContextPath: null, dockerBuildStage: null, command: null,
    registryUrl: null, domains: [], redirects: [], ports: [], security: [], deployments: [],
    cpuReservation: null, memoryReservation: null, healthCheckSwarm: null,
    restartPolicySwarm: null, autoDeploy: false, branch: null, buildPath: null,
    gitUrl: "https://example.test/acme/source.git", watchPaths: [], webhookUrl: null,
    ...overrides,
  };
}

describe("service matching", () => {
  it.each([
    ["name", "STOREfront"],
    ["appName", "shop-web"],
    ["dockerImage", "NGINX:ALPINE"],
    ["repository", "acme/catalog"],
    ["gitUrl", "source.git"],
    ["projectName", "COMMERCE"],
    ["environmentName", "production"],
  ])("matches the %s field without case sensitivity", (_field, q) => {
    const service = application();
    expect(filterServices([service], { q, status: "all" }).matches).toEqual([service]);
  });

  it("requires every query token across fields and ignores surrounding whitespace", () => {
    const service = application();
    expect(filterServices([service], { q: "  Storefront\tcommerce\nALPINE  ", status: "all" }).matches).toEqual([service]);
    expect(filterServices([service], { q: "Storefront missing", status: "all" }).matches).toEqual([]);
  });

  it("handles blank searches, nullable sources, database and compose services", () => {
    const app = application({ dockerImage: null, repository: null, gitUrl: null });
    const database: Service = {
      ...app, kind: "database", engine: "postgres", databaseName: null,
      databaseUser: null, databasePassword: null, externalPort: null,
    };
    const compose: Service = { ...app, kind: "compose", composeFile: null, composeType: null };
    const services = [app, database, compose];
    expect(filterServices(services, { q: " \t ", status: "all" }).matches).toEqual(services);
    expect(filterServices(services, { q: "production", status: "all" }).matches).toEqual(services);
    expect(filterServices(services, { q: "null", status: "all" }).matches).toEqual([]);
  });

  it("does not search hidden configuration fields", () => {
    const service = application({ env: "PASSWORD=private-marker", branch: "hidden-branch" });
    expect(filterServices([service], { q: "private-marker", status: "all" }).matches).toEqual([]);
    expect(filterServices([service], { q: "hidden-branch", status: "all" }).matches).toEqual([]);
  });
});

describe("status filtering and counts", () => {
  const statuses: ServiceStatus[] = ["idle", "running", "done", "error"];
  const runtimes: (ServiceRuntime["health"] | undefined)[] = [undefined, "running", "degraded", "not-running"];
  const expected: Record<ServiceStatus, ServiceFilterStatus[]> = {
    idle: ["stopped", "stopped", "stopped", "stopped"],
    running: ["deploying", "deploying", "deploying", "deploying"],
    done: ["running", "running", "error", "stopped"],
    error: ["error", "running", "error", "stopped"],
  };

  for (const status of statuses) {
    it.each(runtimes.map((health, index) => ({ health, bucket: expected[status][index] })))(
      `buckets ${status} with runtime $health as $bucket`,
      ({ health, bucket }) => {
        const service = application({ status, runtime: health ? { health, running: 1, total: 2 } : undefined });
        for (const option of SERVICE_FILTERS) {
          const result = filterServices([service], { q: "", status: option.value });
          expect(result.matches).toEqual(option.value === "all" || option.value === bucket ? [service] : []);
          expect(result.counts.all).toBe(1);
          expect(result.counts[bucket]).toBe(1);
        }
      },
    );
  }

  it("counts text matches before status selection and keeps original order", () => {
    const services = [
      application({ id: "running", status: "done" }),
      application({ id: "deploying", status: "running" }),
      application({ id: "error", status: "error" }),
      application({ id: "stopped", status: "idle" }),
      application({ id: "excluded", status: "done", projectName: "Other" }),
    ];
    const result = filterServices(services, { q: "commerce", status: "error" });
    expect(result.matches.map((service) => service.id)).toEqual(["error"]);
    expect(result.counts).toEqual({ all: 4, running: 1, deploying: 1, error: 1, stopped: 1 });
    expect(filterServices(services, { q: "commerce", status: "all" }).matches).toEqual(services.slice(0, 4));
    expect(services.map((service) => service.id)).toEqual(["running", "deploying", "error", "stopped", "excluded"]);
  });

  it("returns no matches and zero counts for an empty result or workspace", () => {
    for (const services of [[], [application()]]) {
      expect(filterServices(services, { q: "no-such-service", status: "all" })).toEqual({
        matches: [], counts: { all: 0, running: 0, deploying: 0, error: 0, stopped: 0 },
      });
    }
  });
});

describe("URL persistence", () => {
  it("defaults missing or invalid status parameters to all", () => {
    expect(readServiceFilter(new URLSearchParams())).toEqual({ q: "", status: "all" });
    expect(readServiceFilter(new URLSearchParams("q=shop&status=invalid"))).toEqual({ q: "shop", status: "all" });
    expect(readServiceFilter(new URLSearchParams("status=RUNNING"))).toEqual({ q: "", status: "all" });
  });

  it.each(SERVICE_FILTERS)("round-trips the $value status and encoded search", ({ value }) => {
    const filter = { q: "shop + api/& #prod", status: value };
    const url = new URL(serviceFilterUrl("http://localhost:3036/workspace?view=canvas&tag=one&tag=two#services", filter), "http://localhost");
    expect(readServiceFilter(url.searchParams)).toEqual(filter);
    expect(url.pathname).toBe("/workspace");
    expect(url.searchParams.get("view")).toBe("canvas");
    expect(url.searchParams.getAll("tag")).toEqual(["one", "two"]);
    expect(url.hash).toBe("#services");
  });

  it("clears only filter parameters and omits the query delimiter when empty", () => {
    expect(serviceFilterUrl("/?q=shop&status=error&view=grid#services", { q: "", status: "all" })).toBe("/?view=grid#services");
    expect(serviceFilterUrl("/?q=shop&status=error", { q: " \t", status: "all" })).toBe("/");
  });
});

describe("canvas filtering", () => {
  it("keeps unmatched items visible at reduced opacity", () => {
    expect(serviceFilterOpacity(true)).toBe(1);
    expect(serviceFilterOpacity(false)).toBeGreaterThan(0);
    expect(serviceFilterOpacity(false)).toBeLessThan(serviceFilterOpacity(true));
  });
  it.each([
    [true, true, 1],
    [true, false, 0.2],
    [false, true, 0.2],
    [false, false, 0.2],
  ] as const)("dims edges for endpoint matches %s / %s", (source, target, opacity) => {
    expect(serviceFilterOpacity(source, target)).toBe(opacity);
  });
});

describe("filter keyboard shortcuts", () => {
  const event = { key: "/", ctrlKey: false, altKey: false, metaKey: false, isComposing: false, defaultPrevented: false };
  const context = { editable: false, overlayOpen: false, searchFocused: false };

  it("focuses search with slash outside editable fields", () => {
    expect(serviceFilterShortcut(event, context)).toBe("focus");
    expect(serviceFilterShortcut(event, { ...context, editable: true })).toBeNull();
  });

  it("clears only when Escape is pressed in search", () => {
    expect(serviceFilterShortcut({ ...event, key: "Escape" }, { ...context, editable: true, searchFocused: true })).toBe("clear");
    expect(serviceFilterShortcut({ ...event, key: "Escape" }, context)).toBeNull();
    expect(serviceFilterShortcut({ ...event, key: "Enter" }, context)).toBeNull();
  });

  it.each(["ctrlKey", "altKey", "metaKey", "isComposing", "defaultPrevented"] as const)("ignores shortcuts with %s", (flag) => {
    expect(serviceFilterShortcut({ ...event, [flag]: true }, context)).toBeNull();
    expect(serviceFilterShortcut({ ...event, key: "Escape", [flag]: true }, { ...context, searchFocused: true })).toBeNull();
  });

  it("leaves shortcut handling to an open overlay", () => {
    expect(serviceFilterShortcut(event, { ...context, overlayOpen: true })).toBeNull();
    expect(serviceFilterShortcut({ ...event, key: "Escape" }, { ...context, overlayOpen: true, searchFocused: true })).toBeNull();
  });
});
