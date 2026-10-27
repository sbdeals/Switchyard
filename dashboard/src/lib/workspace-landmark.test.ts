import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadWorkspace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  unstable_rethrow: () => {},
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/dokploy", () => ({ loadWorkspace, inferEdges: () => [] }));
vi.mock("@/lib/collector", () => ({ ensureCollector: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-session" }) }),
}));
vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "switchyard_session",
  openSession: () => ({ email: "test@example.test" }),
}));
vi.mock("@/components/Workspace", () => ({
  Workspace: () => createElement("section", null, "Workspace contents"),
}));
vi.mock("@/components/LogoutButton", () => ({
  LogoutButton: () => createElement("button", null, "Sign out"),
}));

import Page from "../app/page";

afterEach(() => vi.restoreAllMocks());

describe("workspace landmark", () => {
  it("wraps the loaded workspace and controls in one main landmark", async () => {
    loadWorkspace.mockResolvedValueOnce({ services: [], projects: [] });
    const html = renderToStaticMarkup(await Page());

    expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
    expect(html).toMatch(/^<main>.*Sign out.*Workspace contents.*<\/main>$/);
  });

  it.each([
    [new Error("Test workspace failure"), "Something went wrong"],
    [Object.assign(new Error("Test connection failure"), { code: "ECONNREFUSED" }), "Can&#x27;t reach Dokploy"],
  ])("keeps the error panel inside one main landmark (%s)", async (error, heading) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadWorkspace.mockRejectedValueOnce(error);
    const html = renderToStaticMarkup(await Page());

    expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
    expect(html).toMatch(/^<button>Sign out<\/button><main\s[^>]*>.*<\/main>$/);
    expect(html).toContain(`>${heading}</h1>`);
    expect(html).toContain("Retry");
  });
});
