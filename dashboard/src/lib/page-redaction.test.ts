import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "../app/page";
import type { Service } from "./dokploy";

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  inferEdges: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("./dokploy", () => ({
  loadWorkspace: mocks.loadWorkspace,
  inferEdges: mocks.inferEdges,
}));
vi.mock("./collector", () => ({ ensureCollector: vi.fn() }));
vi.mock("../components/LogoutButton", () => ({ LogoutButton: () => null }));
vi.mock("../components/Workspace", () => ({
  Workspace: (props: unknown) => {
    mocks.workspace(props);
    return createElement("pre", null, JSON.stringify(props));
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("workspace page data", () => {
  it("redacts every service before serialization while inferring edges from server env", async () => {
    const services = ["application", "compose", "postgres", "mysql", "mariadb", "mongo", "redis"].map(
      (type, index) => ({
        id: `service-${index}`,
        name: `service-${index}`,
        kind: type === "application" || type === "compose" ? type : "database",
        ...(type === "application" || type === "compose" ? {} : {
          engine: type,
          databasePassword: `password-sentinel-${index}`,
        }),
        env: `TOKEN=env-sentinel-${index}`,
      }),
    ) as Service[];
    const projects = [{ projectId: "project", name: "Project", environments: [
      { environmentId: "a", name: "A" },
      { environmentId: "b", name: "B" },
    ] }];
    const edges = [{ source: "service-0", target: "service-2" }];
    mocks.loadWorkspace.mockResolvedValue({ services, projects });
    mocks.inferEdges.mockReturnValue(edges);

    const html = renderToStaticMarkup(await Page());

    expect(html).not.toContain("env-sentinel-");
    expect(html).not.toContain("password-sentinel-");
    expect(mocks.workspace).toHaveBeenCalledWith({
      services: services.map((service) => ({
        ...service,
        env: null,
        ...(service.kind === "database" ? { databasePassword: null } : {}),
      })),
      projects,
      edges,
    });
    expect(mocks.inferEdges).toHaveBeenCalledWith(services);
    expect(services[0].env).toBe("TOKEN=env-sentinel-0");
  });
});
