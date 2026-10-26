import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadWorkspace, inferEdges } = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  inferEdges: vi.fn(),
}));

vi.mock("@/lib/dokploy", () => ({ loadWorkspace, inferEdges }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));

import { GET } from "../app/api/workspace/route";

const services = [{ id: "app", projectId: "project", deployments: [] }];
const projects = [{ id: "project", name: "Project", environments: [] }];
const edges = [{ source: "app", target: "database" }];

beforeEach(() => {
  vi.clearAllMocks();
  loadWorkspace.mockResolvedValue({ services, projects });
  inferEdges.mockReturnValue(edges);
});

describe("workspace polling endpoint", () => {
  it("returns the current user's services, projects and inferred edges without caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ services, projects, edges });
    expect(inferEdges).toHaveBeenCalledWith(services);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("reloads the authenticated workspace on each request without sharing users' data", async () => {
    expect(await (await GET()).json()).toEqual({ services, projects, edges });
    loadWorkspace.mockResolvedValue({ services: [], projects: [] });
    inferEdges.mockReturnValue([]);
    const response = await GET();
    expect(await response.json()).toEqual({ services: [], projects: [], edges: [] });
    expect(loadWorkspace).toHaveBeenCalledTimes(2);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("signals failed refreshes without exposing internal errors or caching failures", async () => {
    loadWorkspace.mockRejectedValue(new Error("private backend response details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Workspace unavailable." });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(inferEdges).not.toHaveBeenCalled();
  });

  it("preserves login redirects from the user's authentication", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    loadWorkspace.mockRejectedValue(redirect);
    await expect(GET()).rejects.toBe(redirect);
    expect(inferEdges).not.toHaveBeenCalled();
  });
});
