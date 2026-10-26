import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const loadWorkspace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("@/lib/dokploy", () => ({ loadWorkspace, inferEdges: () => [] }));
vi.mock("@/lib/collector", () => ({ ensureCollector: () => {} }));
vi.mock("@/components/Workspace", () => ({
  Workspace: () => createElement("section", null, "Workspace contents"),
}));
vi.mock("@/components/LogoutButton", () => ({
  LogoutButton: () => createElement("button", null, "Sign out"),
}));

import Page from "../app/page";

describe("workspace landmark", () => {
  it("wraps the loaded workspace and controls in one main landmark", async () => {
    loadWorkspace.mockResolvedValueOnce({ services: [], projects: [] });
    const html = renderToStaticMarkup(await Page());

    expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
    expect(html).toMatch(/^<main>.*Sign out.*Workspace contents.*<\/main>$/);
  });

  it("keeps the connection error inside one main landmark", async () => {
    loadWorkspace.mockRejectedValueOnce(new Error("Test connection failure"));
    const html = renderToStaticMarkup(await Page());

    expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
    expect(html).toMatch(/^<main\s[^>]*>.*<h1.*Test connection failure.*<\/main>$/);
  });
});
