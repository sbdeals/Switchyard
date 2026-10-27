import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ overrides: {} as Record<number, unknown>, calls: 0 }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = state.calls++;
      return react.useState(index in state.overrides ? state.overrides[index] : initial);
    },
  };
});

// Guarded client actions wrap every server action at import time.
vi.mock("@/app/actions", () => new Proxy({} as Record<string, unknown>, {
  has: (_target, key) => typeof key === "string" && key.endsWith("Action"),
  get: (target, key) => {
    if (typeof key !== "string" || !key.endsWith("Action")) return undefined;
    return (target[key] ??= vi.fn());
  },
}));
vi.mock("@/app/db-connect-actions", () => ({ getDatabaseConnectionAction: vi.fn() }));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/lib/engines", () => ({ ENGINE_LIST: [] }));
vi.mock("@/components/GithubDeployModal", () => ({ GithubDeployModal: () => null }));
vi.mock("@/components/use-focus-trap", () => ({ useDialogFocus: () => undefined }));

import { QuickDeployMenu } from "../components/QuickDeployMenu";

function renderMenu() {
  return renderToStaticMarkup(createElement(QuickDeployMenu, { projects: [], onDeployed: () => {} }));
}

describe("quick deploy accessibility", () => {
  beforeEach(() => {
    state.overrides = {};
    state.calls = 0;
  });

  it("announces that New service opens a dialog", () => {
    const html = renderMenu();
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-controls=');
  });

  it("links the expanded opener to the named modal dialog", () => {
    state.overrides[0] = true;
    const html = renderMenu();
    const controlledId = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controlledId).toBeTruthy();
    expect(html).toContain('aria-expanded="true"');
    const dialog = html.match(/<div[^>]*role="dialog"[^>]*>/)?.[0];
    expect(dialog).toContain(`id="${controlledId}"`);
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('aria-label="New service"');
  });

  it.each([
    { loading: true, error: null, templates: null, role: "status", message: "Loading catalog…" },
    { loading: false, error: "Catalog unavailable", templates: null, role: "alert", message: "Catalog unavailable" },
    { loading: false, error: null, templates: [], role: "status", message: "No templates available" },
  ])("announces catalog feedback: $message", ({ loading, error, templates, role, message }) => {
    // Main added the source and image port state before the repo and catalog state.
    // Render the open dialog and catalog without running deployment actions.
    state.overrides = { 0: true, 9: true, 10: templates, 11: error, 12: loading };
    const html = renderMenu();
    const controlledIds = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1]);
    expect(controlledIds).toHaveLength(2);
    expect(html).toContain(`id="${controlledIds[1]}"`);
    expect(html).toMatch(new RegExp(`<div role="${role}"[^>]*>(?:<[^>]+>|[^<])*${message}`));
  });
});
