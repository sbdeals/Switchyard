import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "../app/page";
import type { ComposeService, Service } from "./dokploy";

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  inferEdges: vi.fn(),
  workspace: vi.fn(),
  redirect: new Error("NEXT_REDIRECT"),
}));

vi.mock("@/lib/dokploy", () => ({
  loadWorkspace: mocks.loadWorkspace,
  inferEdges: mocks.inferEdges,
}));
vi.mock("@/lib/collector", () => ({ ensureCollector: vi.fn() }));
vi.mock("@/components/Workspace", () => ({ Workspace: mocks.workspace }));
vi.mock("@/components/LogoutButton", () => ({ LogoutButton: () => null }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error === mocks.redirect) throw error;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inferEdges.mockReturnValue([]);
  mocks.workspace.mockImplementation((props: { services: Service[] }) =>
    createElement("pre", null, JSON.stringify(props)),
  );
});

describe("workspace page", () => {
  it.each([
    new Error("connect ECONNREFUSED 127.0.0.1:3000"),
    "Invalid workspace: name is required",
  ])("renders useful backend failure details (%s)", async (failure) => {
    mocks.loadWorkspace.mockRejectedValueOnce(failure);

    const html = renderToStaticMarkup(await Page());

    expect(html).toContain("reach Dokploy");
    expect(html).toContain(failure instanceof Error ? failure.message : failure);
    expect(html).toContain("<pre");
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it.each([
    new Error('ECONNREFUSED "https://PAGE_USER_SENTINEL:PAGE_PASSWORD_SENTINEL@localhost:3000/api/deploy/PAGE_WEBHOOK_SENTINEL"; retry ssh://PAGE_SSH_SENTINEL@localhost/repo'),
    'Invalid URL "https://PAGE_USER_SENTINEL:PAGE_PASSWORD_SENTINEL@localhost/api/deploy/PAGE_WEBHOOK_SENTINEL"; retry ssh://PAGE_SSH_SENTINEL@localhost/repo',
  ])("scrubs credentials from backend failure details (%s)", async (failure) => {
    mocks.loadWorkspace.mockRejectedValueOnce(failure);

    const html = renderToStaticMarkup(await Page());

    expect(html).toContain(failure instanceof Error ? "ECONNREFUSED" : "Invalid URL");
    expect(html).toContain("/api/deploy/***");
    expect(html).toContain("ssh://localhost/repo");
    expect(html).not.toContain("PAGE_USER_SENTINEL");
    expect(html).not.toContain("PAGE_PASSWORD_SENTINEL");
    expect(html).not.toContain("PAGE_WEBHOOK_SENTINEL");
    expect(html).not.toContain("PAGE_SSH_SENTINEL");
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("redacts service props at the client boundary while retaining server data", async () => {
    const compose: ComposeService = {
      kind: "compose",
      id: "compose-id",
      name: "test-compose",
      appName: "test-compose-app",
      status: "idle",
      projectId: "project-id",
      projectName: "Test project",
      environmentId: "environment-id",
      environmentName: "test",
      dockerImage: null,
      env: "TOKEN=ENV_PAGE_SENTINEL",
      createdAt: null,
      cpuLimit: null,
      memoryLimit: null,
      replicas: null,
      composeFile: "services:\n  db:\n    image: postgres\n    environment:\n      TOKEN: COMPOSE_PAGE_SENTINEL",
      composeType: "docker-compose",
      domains: [],
      deployments: [],
    };
    const services = [compose];
    const original = structuredClone(services);
    mocks.loadWorkspace.mockResolvedValueOnce({ services, projects: [] });

    const html = renderToStaticMarkup(await Page());
    const props = mocks.workspace.mock.calls[0][0];

    expect(html).not.toContain("ENV_PAGE_SENTINEL");
    expect(html).not.toContain("COMPOSE_PAGE_SENTINEL");
    expect(props.services[0]).toMatchObject({
      env: null,
      composeFile: null,
      serviceNames: ["db"],
      hasPostgres: true,
    });
    expect(mocks.inferEdges).toHaveBeenCalledWith(services);
    expect(services).toEqual(original);
  });

  it("preserves a login redirect instead of rendering the error panel", async () => {
    mocks.loadWorkspace.mockRejectedValueOnce(mocks.redirect);

    await expect(Page()).rejects.toBe(mocks.redirect);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});
