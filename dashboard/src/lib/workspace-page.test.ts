import { createElement } from "react";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Page from "../app/page";
import type { ComposeService, Service } from "./dokploy";
import { redactErrorMessage } from "./error-redaction";
import { openSession } from "./session";

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
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/session", () => ({ openSession: vi.fn(() => null), SESSION_COOKIE: "switchyard_session" }));
vi.mock("@/lib/collector", () => ({ ensureCollector: vi.fn() }));
vi.mock("@/components/Workspace", () => ({ Workspace: mocks.workspace }));
vi.mock("@/components/LogoutButton", () => ({ LogoutButton: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: (error: unknown) => {
    if (error === mocks.redirect) throw error;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.inferEdges.mockReturnValue([]);
  mocks.workspace.mockImplementation((props: { services: Service[] }) =>
    createElement("pre", null, JSON.stringify(props)),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function expectFailurePanel(html: string, unreachable: boolean) {
  const details = html.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
  expect(details).not.toBeNull();
  expect(details![1]).not.toMatch(/\bopen(?:\s|=|$)/);
  expect(details![2]).toContain(">Show details</summary>");
  const pre = details![2].match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/);
  expect(pre).not.toBeNull();
  const visible = html.replace(details![0], "");
  expect(visible).toContain(unreachable ? "reach Dokploy" : "Something went wrong");
  if (!unreachable) expect(visible).toMatch(/Error reference: <code>[a-f0-9]{8}<\/code>/);
  for (const sentinel of ["PAGE_USER_SENTINEL", "PAGE_PASSWORD_SENTINEL", "PAGE_WEBHOOK_SENTINEL", "PAGE_SSH_SENTINEL"]) {
    expect(html).not.toContain(sentinel);
  }
  return pre![1];
}

describe("workspace page", () => {
  it.each([
    Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), { code: "ECONNREFUSED" }),
    "Invalid workspace: name is required",
  ])("renders useful backend failure details (%s)", async (failure) => {
    mocks.loadWorkspace.mockRejectedValueOnce(failure);

    const html = renderToStaticMarkup(await Page());

    const details = expectFailurePanel(html, failure instanceof Error);
    expect(details).toContain(failure instanceof Error ? failure.message : failure);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error('ECONNREFUSED "https://PAGE_USER_SENTINEL:PAGE_PASSWORD_SENTINEL@localhost:3000/api/deploy/PAGE_WEBHOOK_SENTINEL"; retry ssh://PAGE_SSH_SENTINEL@localhost/repo'), { code: "ECONNREFUSED" }),
    'Invalid URL "https://PAGE_USER_SENTINEL:PAGE_PASSWORD_SENTINEL@localhost/api/deploy/PAGE_WEBHOOK_SENTINEL"; retry ssh://PAGE_SSH_SENTINEL@localhost/repo',
  ])("scrubs credentials from backend failure details (%s)", async (failure) => {
    mocks.loadWorkspace.mockRejectedValueOnce(failure);

    const html = renderToStaticMarkup(await Page());

    const details = expectFailurePanel(html, failure instanceof Error);
    expect(details).toContain(failure instanceof Error ? "ECONNREFUSED" : "Invalid URL");
    expect(details).toContain("/api/deploy/***");
    expect(details).toContain("ssh://localhost/repo");
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it.each(["unknown", "unreachable", "string"])("only renders and logs scrubbed details for a %s failure", async (kind) => {
    const message = "Invalid workspace; Bearer PAGE_BEARER_SENTINEL; Authorization: Basic PAGE_AUTH_SENTINEL\nhttp://demo-user:demo-pass@host?token=PAGE_QUERY_SENTINEL\nSECRET=PAGE_ENV_SENTINEL";
    const failure = kind === "string" ? message : Object.assign(new Error(message, {
      cause: new Error(`CAUSE_ONLY_SENTINEL ${message}`),
    }), {
      stack: `STACK_ONLY_SENTINEL ${message}`,
      digest: "DIGEST_ONLY_SENTINEL",
      ...(kind === "unreachable" ? { code: "ECONNREFUSED" } : {}),
    });
    mocks.loadWorkspace.mockRejectedValueOnce(failure);

    const html = renderToStaticMarkup(await Page());
    const details = expectFailurePanel(html, kind === "unreachable");
    expect(`<pre>${details}</pre>`).toBe(renderToStaticMarkup(createElement(
      "pre", null, redactErrorMessage(failure, "Could not load workspace."),
    )));
    expect(details).toContain("Invalid workspace");
    expect(details).toContain("http://host?token=***");
    expect(details).toContain("SECRET=***");
    expect(html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/, "")).not.toContain("Invalid workspace");
    for (const sentinel of [
      "PAGE_BEARER_SENTINEL", "PAGE_AUTH_SENTINEL", "demo-user", "demo-pass",
      "PAGE_QUERY_SENTINEL", "PAGE_ENV_SENTINEL", "STACK_ONLY_SENTINEL", "CAUSE_ONLY_SENTINEL", "DIGEST_ONLY_SENTINEL",
    ]) {
      expect(html).not.toContain(sentinel);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(sentinel);
    }
    if (kind === "unreachable") {
      expect(console.error).not.toHaveBeenCalled();
    } else {
      const reference = html.match(/Error reference: <code>([a-f0-9]{8})<\/code>/)![1];
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        `Workspace load failed (${reference}): ${redactErrorMessage(failure, "Could not load workspace.")}`,
      );
    }
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
      hasVariables: true,
      composeFile: null,
      serviceNames: ["db"],
      hasPostgres: true,
    });
    expect(mocks.inferEdges).toHaveBeenCalledWith(services);
    expect(services).toEqual(original);
  });

  it("passes only the normalized email hash for onboarding dismissal", async () => {
    const email = " Onboarding.User@Example.test ";
    vi.mocked(openSession).mockReturnValueOnce({ email, dokployCookie: "SESSION_SENTINEL", iat: 0 });
    mocks.loadWorkspace.mockResolvedValueOnce({ services: [], projects: [] });

    const html = renderToStaticMarkup(await Page());
    const props = mocks.workspace.mock.calls[0][0];

    expect(props.userId).toBe(createHash("sha256").update("onboarding.user@example.test").digest("hex"));
    expect(html).not.toContain(email);
    expect(html).not.toContain("SESSION_SENTINEL");
  });

  it("preserves a login redirect instead of rendering the error panel", async () => {
    mocks.loadWorkspace.mockRejectedValueOnce(mocks.redirect);

    await expect(Page()).rejects.toBe(mocks.redirect);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});
