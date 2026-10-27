import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-session",
  openSession: () => ({ dokployCookie: "test-cookie" }),
}));
vi.mock("./docker", () => ({
  listRuntimeStates: async () => { throw new Error("No Docker in unit tests"); },
}));

import { loadWorkspace } from "./dokploy";

afterEach(() => vi.unstubAllGlobals());

describe("delete impact metadata", () => {
  function mockDetails(detail: Record<string, unknown>) {
    const fetch = vi.fn(async (url: string) => {
      const data = url.endsWith("/project.all") ? [{
        projectId: "project",
        name: "Project",
        environments: [{
          environmentId: "environment",
          name: "Environment",
          applications: [{ applicationId: "app" }],
          compose: [{ composeId: "compose" }],
          postgres: [{ postgresId: "database" }],
        }],
      }] : detail;
      return new Response(JSON.stringify(data));
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("reuses service details and exposes only mount kinds for all service types", async () => {
    const fetch = mockDetails({
      mounts: [{ type: "file", content: "private file", hostPath: "/private/path" }],
      deployments: [{ deploymentId: "deployment", status: "done", title: "Deploy" }],
    });
    const { services } = await loadWorkspace();
    expect(services).toHaveLength(3);
    for (const service of services) {
      expect(service.mounts).toEqual([{ type: "file" }]);
      expect(service.deployments).toHaveLength(1);
    }
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname).sort()).toEqual([
      "/api/application.one",
      "/api/compose.one",
      "/api/postgres.one",
      "/api/project.all",
    ]);
  });

  it("preserves missing metadata so deletion summaries can report unknown counts", async () => {
    mockDetails({});
    const { services } = await loadWorkspace();
    expect(services.every((service) => service.mounts === undefined)).toBe(true);
    expect(services.find((service) => service.kind === "database")?.deployments).toBeUndefined();
  });

  it("preserves loaded empty metadata as known zero counts", async () => {
    mockDetails({ mounts: [], deployments: [] });
    const { services } = await loadWorkspace();
    expect(services.every((service) => service.mounts?.length === 0)).toBe(true);
    expect(services.every((service) => service.deployments?.length === 0)).toBe(true);
  });
});
