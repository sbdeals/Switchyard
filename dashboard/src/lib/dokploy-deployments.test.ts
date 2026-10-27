import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-session" }) }),
}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-session",
  openSession: () => ({ dokployCookie: "test-cookie" }),
}));
vi.mock("./docker", () => ({
  listRuntimeStates: async () => ({ compose: new Map(), swarm: new Map() }),
  deriveComposeRuntime: () => undefined,
  deriveSwarmRuntime: () => undefined,
}));

import { loadWorkspace } from "./dokploy";

afterEach(() => vi.unstubAllGlobals());

describe("deployment timestamp mapping", () => {
  it.each(["application", "compose"])("preserves %s timings and leaves absent timings unavailable", async (kind) => {
    const createdAt = "2026-10-26T10:00:00.000Z";
    const startedAt = "2026-10-26T10:00:05.000Z";
    const finishedAt = "2026-10-26T10:01:17.000Z";
    const deployments = [
      { deploymentId: "timed", status: "done", createdAt, startedAt, finishedAt },
      { deploymentId: "legacy", status: "done", createdAt },
      { deploymentId: "cancelled", status: "cancelled", createdAt, startedAt, finishedAt: null },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/project.all") {
        return Response.json([{
          projectId: "project",
          name: "Test project",
          environments: [{
            environmentId: "environment",
            name: "Test environment",
            applications: kind === "application" ? [{ applicationId: "service" }] : [],
            compose: kind === "compose" ? [{ composeId: "service" }] : [],
          }],
        }]);
      }
      if (path === `/api/${kind}.one`) {
        return Response.json({ name: "Test service", deployments });
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { services } = await loadWorkspace();
    const service = services[0];
    expect(service.kind).toBe(kind);
    if (service.kind === "database") throw new Error("Expected deployable service");
    expect(service.deployments).toMatchObject([
      { deploymentId: "timed", createdAt, startedAt, finishedAt },
      { deploymentId: "legacy", createdAt, startedAt: null, finishedAt: null },
      { deploymentId: "cancelled", status: "cancelled", startedAt, finishedAt: null },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
