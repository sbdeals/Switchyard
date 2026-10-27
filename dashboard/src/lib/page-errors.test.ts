import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  workspace: vi.fn(),
  ensureCollector: vi.fn(),
  unstableRethrow: vi.fn(),
  refresh: vi.fn(),
  pending: false,
  startTransition: vi.fn((callback: () => void) => callback()),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useTransition: () => [mocks.pending, mocks.startTransition],
}));
vi.mock("@/lib/dokploy", () => ({
  loadWorkspace: mocks.loadWorkspace,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-session" }) }),
}));
vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "switchyard_session",
  openSession: () => ({ email: "test@example.test" }),
}));
vi.mock("@/lib/collector", () => ({ ensureCollector: mocks.ensureCollector }));
vi.mock("@/components/Workspace", () => ({
  Workspace: mocks.workspace,
}));
vi.mock("@/components/LogoutButton", () => ({
  LogoutButton: () => createElement("button", null, "Sign out"),
}));
vi.mock("@/components/DokployUnavailable", async () =>
  import("../components/DokployUnavailable"));
vi.mock("@/lib/workspace-error", async () => import("./workspace-error"));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    unstable_rethrow: (error: unknown) => {
      mocks.unstableRethrow(error);
      actual.unstable_rethrow(error);
    },
    useRouter: () => ({ refresh: mocks.refresh }),
  };
});

import Page from "../app/page";
import ErrorPage from "../app/error";
import GlobalError from "../app/global-error";
import NotFound from "../app/not-found";
import Loading from "../app/loading";
import { DokployUnavailable } from "../components/DokployUnavailable";

function findRetry(node: ReactNode): (() => void) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const retry = findRetry(child);
      if (retry) return retry;
    }
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.type === "button") return node.props.onClick;
  return findRetry(node.props.children);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockImplementation(() => createElement("div", null, "Workspace loaded"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.pending = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workspace load failures", () => {
  it("renders the workspace after a successful load", async () => {
    mocks.loadWorkspace.mockResolvedValueOnce({ services: [], projects: [] });
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Workspace loaded");
    expect(html).toContain("Sign out");
    expect(mocks.workspace.mock.calls[0][0]).toEqual({
      services: [], projects: [], graph: { edges: [], warnings: {} }, notificationScope: expect.any(String),
    });
  });

  it("renders a sanitized outage state with Retry", async () => {
    const error = new TypeError("fetch failed", {
      cause: new Error("private backend address and credentials"),
    });
    mocks.loadWorkspace.mockRejectedValueOnce(error);
    const html = renderToStaticMarkup(await Page());
    expect(mocks.unstableRethrow).toHaveBeenCalledWith(error);
    expect(html).toContain("Can&#x27;t reach Dokploy");
    expect(html).toContain("Retry");
    expect(html).toContain("Sign out");
    expect(html).toContain("DOKPLOY_URL");
    expect(html).toContain("DOKPLOY_EMAIL");
    expect(html).toContain("DOKPLOY_PASSWORD");
    expect(html).toContain("switchyard config");
    expect(html).toContain("managed container");
    expect(html).toContain(".env.local");
    expect(html).toContain("source");
    expect(html).toMatch(/<details\b[^>]*>.*Show details<\/summary><pre[^>]*>fetch failed<\/pre><\/details>/);
    expect(html).not.toMatch(/<details\b[^>]*\bopen(?:\s|=|>)/);
    expect(html).not.toContain("private backend");
  });

  it("propagates actual Next auth redirects before rendering a failure state", async () => {
    let authRedirect: unknown;
    try {
      redirect("/login");
    } catch (error) {
      authRedirect = error;
    }
    expect(authRedirect).toBeDefined();
    mocks.loadWorkspace.mockRejectedValueOnce(authRedirect);
    await expect(Page()).rejects.toBe(authRedirect);
    expect(mocks.unstableRethrow).toHaveBeenCalledWith(authRedirect);
  });

  it("propagates a redirect nested inside an apparent network error", async () => {
    let authRedirect: unknown;
    try {
      redirect("/login");
    } catch (error) {
      authRedirect = error;
    }
    mocks.loadWorkspace.mockRejectedValueOnce(new TypeError("fetch failed", { cause: authRedirect }));
    await expect(Page()).rejects.toBe(authRedirect);
  });

  it.each([
    new TypeError("Cannot read properties of undefined"),
    new SyntaxError("Invalid JSON"),
  ])("renders a generic panel and reference for non-transport errors: %s", async (error) => {
    mocks.loadWorkspace.mockRejectedValueOnce(error);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Something went wrong");
    expect(html).toMatch(/Error reference: <code>[a-f0-9]{8}<\/code>/);
    expect(html).toContain("Show details");
    expect(mocks.unstableRethrow).toHaveBeenCalledWith(error);
  });

  it.each([
    Object.assign(new Error("Unauthorized"), { status: 401 }),
    Object.assign(new Error("Forbidden"), { status: 403 }),
  ])("keeps rethrowing auth failures: %s", async (error) => {
    mocks.loadWorkspace.mockRejectedValueOnce(error);
    await expect(Page()).rejects.toBe(error);
    expect(mocks.unstableRethrow).toHaveBeenCalledWith(error);
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("route fallback UI", () => {
  it("refreshes workspace data when retrying an outage", () => {
    const retry = findRetry(DokployUnavailable());
    expect(retry).toBeDefined();
    retry!();
    expect(mocks.startTransition).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("disables Retry while a workspace refresh is pending", () => {
    mocks.pending = true;
    const html = renderToStaticMarkup(createElement(DokployUnavailable));
    expect(html).toContain("Retrying…");
    expect(html).toContain('disabled=""');
  });

  it.each([
    ["page", ErrorPage],
    ["global", GlobalError],
  ] as const)("shows a safe %s error reference and retries", (_name, Component) => {
    const reset = vi.fn();
    const error = Object.assign(new Error("sensitive exception details"), {
      digest: "report-123",
      stack: "sensitive stack trace",
    });
    const element = Component({ error, reset });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("report-123");
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to projects");
    expect(html).not.toContain(error.message);
    expect(html).not.toContain(error.stack);
    expect(html).not.toContain("Show details");
    const retry = findRetry(element);
    expect(retry).toBeDefined();
    retry!();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("renders global errors with their own document", () => {
    const html = renderToStaticMarkup(createElement(GlobalError, {
      error: new Error("hidden"), reset: vi.fn(),
    }));
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<body");
    expect(html).not.toContain("Error reference");
  });

  it("provides a project navigation link for missing pages", () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toContain("404");
    expect(html).toContain("Page not found");
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to projects");
  });

  it("announces loading while hiding decorative skeletons", () => {
    const html = renderToStaticMarkup(createElement(Loading));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading services"');
    expect(html).toContain('aria-hidden="true"');
  });
});
