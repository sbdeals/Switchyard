vi.mock("server-only", () => ({}));
import type { Service } from "./dokploy";
import { redactServiceForClient } from "./service-redaction";
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

const base = {
  projectId: "project", deployments: [], dockerImage: null, env: "TOKEN=ENV_POLL_SENTINEL",
};
const services = [
  {
    ...base, id: "app", kind: "application", description: "DESCRIPTION_POLL_SENTINEL",
    webhookUrl: "https://example.test/api/deploy/WEBHOOK_POLL_SENTINEL",
    command: "TOKEN=COMMAND_POLL_SENTINEL node server.js",
    healthCheckSwarm: { Test: ["CMD-SHELL", "TOKEN=HEALTH_POLL_SENTINEL check"] },
    repository: "https://user:URL_POLL_SENTINEL@example.test/repo", gitUrl: null,
    registryUrl: null, redirects: [],
  },
  {
    ...base, id: "compose", kind: "compose",
    composeFile: "services:\n  db:\n    image: postgres\n    environment:\n      TOKEN: COMPOSE_POLL_SENTINEL",
  },
  {
    ...base, id: "db", kind: "database", databasePassword: null,
    command: "--password DB_COMMAND_POLL_SENTINEL",
  },
] as Service[];
const redactedServices = services.map(redactServiceForClient);
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
    expect(await response.json()).toEqual({ services: redactedServices, projects, edges, graph: expect.objectContaining({ edges: expect.any(Array), warnings: expect.any(Object) }) });
    expect(inferEdges).toHaveBeenCalledWith(services);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("redacts polling data exactly like page props without changing server-side edge inputs", async () => {
    const original = structuredClone(services);
    const response = await GET();
    const data = await response.json();
    expect(data.services).toEqual(redactedServices);
    expect(JSON.stringify(data)).not.toContain("POLL_SENTINEL");
    expect(data.services[1]).toMatchObject({ composeFile: null, serviceNames: ["db"], hasPostgres: true });
    expect(services).toEqual(original);
    expect(inferEdges).toHaveBeenCalledWith(services);
  });

  it("reloads the authenticated workspace on each request without sharing users' data", async () => {
    expect(await (await GET()).json()).toEqual({ services: redactedServices, projects, edges, graph: expect.objectContaining({ edges: expect.any(Array), warnings: expect.any(Object) }) });
    loadWorkspace.mockResolvedValue({ services: [], projects: [] });
    inferEdges.mockReturnValue([]);
    const response = await GET();
    expect(await response.json()).toEqual({ services: [], projects: [], edges: [], graph: { edges: [], warnings: {} } });
    expect(loadWorkspace).toHaveBeenCalledTimes(2);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("signals failed refreshes without exposing internal errors or caching failures", async () => {
    loadWorkspace.mockRejectedValue(new Error("private backend response details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Workspace unavailable.", code: "unavailable" });
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
