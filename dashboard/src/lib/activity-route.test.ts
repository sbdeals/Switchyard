import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Service } from "./dokploy";
import { GET } from "../app/api/activity/route";

const { loadWorkspace } = vi.hoisted(() => ({ loadWorkspace: vi.fn() }));
vi.mock("@/lib/dokploy", () => ({ loadWorkspace }));
vi.mock("@/lib/activity", async () => import("./activity"));

function service(id: string, createdAt: string): Service {
  return {
    kind: "application",
    id,
    name: `Service ${id}`,
    projectId: "project-1",
    projectName: "Project one",
    environmentId: "env-1",
    environmentName: "Preview",
    env: "PRIVATE_CONFIG=do-not-return",
    deployments: [{
      deploymentId: `deployment-${id}`,
      status: "done",
      title: "Ship activity",
      createdAt,
      startedAt: createdAt,
      finishedAt: "2026-10-26T12:05:00.000Z",
      description: null,
      rollbackId: null,
    }],
  } as Service;
}

describe("activity route", () => {
  beforeEach(() => {
    loadWorkspace.mockReset();
  });

  it("returns only activity fields from the current user's visible services, newest first", async () => {
    loadWorkspace.mockResolvedValue({
      services: [
        service("older", "2026-10-26T12:00:00.000Z"),
        service("newer", "2026-10-26T12:01:00.000Z"),
      ],
      projects: [],
    });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.entries.map((entry: { serviceId: string }) => entry.serviceId)).toEqual(["newer", "older"]);
    expect(body.entries[0]).toMatchObject({
      serviceName: "Service newer",
      environmentName: "Preview",
      status: "done",
      title: "Ship activity",
      startedAt: "2026-10-26T12:01:00.000Z",
      finishedAt: "2026-10-26T12:05:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("PRIVATE_CONFIG");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=10, must-revalidate");
    expect(response.headers.get("Vary")).toBe("Cookie");
  });

  it("does not reuse another user's workspace on subsequent requests", async () => {
    loadWorkspace.mockResolvedValueOnce({
      services: [service("first-user", "2026-10-26T12:00:00.000Z")],
      projects: [],
    }).mockResolvedValueOnce({ services: [], projects: [] });

    await GET();
    const response = await GET();
    expect(await response.json()).toEqual({ entries: [] });
    expect(loadWorkspace).toHaveBeenCalledTimes(2);
  });

  it("fails closed without exposing backend errors or caching a failure", async () => {
    loadWorkspace.mockRejectedValue(new Error("backend-private-details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Activity unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("preserves the framework redirect for an expired session", async () => {
    const error = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    loadWorkspace.mockRejectedValue(error);
    await expect(GET()).rejects.toBe(error);
  });
});
