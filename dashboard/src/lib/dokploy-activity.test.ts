import { afterEach, describe, expect, it, vi } from "vitest";

import { loadWorkspace } from "./dokploy";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-session" }) }),
}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-cookie",
  openSession: () => ({ dokployCookie: "test-user-session" }),
}));
vi.mock("./docker", () => ({
  listRuntimeStates: async () => ({ compose: new Map(), swarm: new Map() }),
  deriveComposeRuntime: () => undefined,
  deriveSwarmRuntime: () => undefined,
}));

describe("workspace activity deployment fields", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves deployment timing, cancellation and description from app and compose detail", async () => {
    const deployment = {
      deploymentId: "deploy-1",
      status: "cancelled",
      description: "Fix deployment timeout",
      createdAt: "2026-10-26T12:00:00.000Z",
      startedAt: "2026-10-26T12:00:03.000Z",
      finishedAt: "2026-10-26T12:00:15.000Z",
    };
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      expect(init.method).toBe("GET");
      expect(init.headers).toMatchObject({ Cookie: "test-user-session" });
      const path = new URL(input).pathname;
      if (path === "/api/project.all") {
        return Response.json([{
          projectId: "project-1",
          name: "Project",
          environments: [{
            environmentId: "env-1",
            name: "Preview",
            applications: [{ applicationId: "app-1" }],
            compose: [{ composeId: "compose-1" }],
          }],
        }]);
      }
      if (path === "/api/application.one" || path === "/api/compose.one") {
        return Response.json({ deployments: [deployment, { deploymentId: "legacy" }] });
      }
      throw new Error(`Unexpected test request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { services } = await loadWorkspace();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(services).toHaveLength(2);
    for (const service of services) {
      expect(service.kind).not.toBe("database");
      if (service.kind === "database") continue;
      expect(service.deployments[0]).toEqual({
        ...deployment,
        title: "Fix deployment timeout",
        rollbackId: null,
      });
      expect(service.deployments[1]).toMatchObject({
        description: null,
        startedAt: null,
        finishedAt: null,
      });
    }
  });
});
