import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { inferEdges, type Service } from "./dokploy";

describe("environment connections after duplication", () => {
  it("keeps references between duplicated service names inside their environment", () => {
    const service = (id: string, name: string, environmentId: string, env = "", projectId = "project") => ({
      id, name, appName: `${id}-runtime`, projectId, environmentId, env,
    }) as Service;
    const services = [
      service("source-web", "web", "source", "BACKEND=http://backend:8080"),
      service("source-backend", "backend", "source"),
      service("copy-web", "web", "copy", "BACKEND=http://backend:8080"),
      service("copy-backend", "backend", "copy"),
      service("other-backend", "backend", "source", "", "other-project"),
    ];

    expect(inferEdges(services)).toEqual([
      { source: "source-web", target: "source-backend" },
      { source: "copy-web", target: "copy-backend" },
    ]);
  });
});
