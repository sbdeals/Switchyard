import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { deleteImpact, serviceDeleteImpact } from "./delete-impact";

// Render the actual dialog without a browser; focus and interaction are covered
// by the local browser proof. Portals only change where the markup is mounted.
vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));
vi.mock("@/components/use-focus-trap", () => ({ useDialogFocus: () => undefined }));

beforeEach(() => {
  vi.stubGlobal("document", { body: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDialog(props: Partial<ComponentProps<typeof DeleteConfirmDialog>> = {}) {
  return renderToStaticMarkup(createElement(DeleteConfirmDialog, {
    name: "My app",
    resource: "service",
    impact: ["Service configuration"],
    onConfirm: vi.fn(async () => ({ ok: true })),
    onClose: vi.fn(),
    onDeleted: vi.fn(),
    ...props,
  }));
}

describe("DeleteConfirmDialog markup", () => {
  it("labels the modal and confirmation input with their visible text", () => {
    const html = renderDialog();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const title = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    const description = html.match(/aria-describedby="([^"]+)"/)?.[1];
    const input = html.match(/<input id="([^"]+)"/)?.[1];
    expect(title).toBeTruthy();
    expect(description).toBeTruthy();
    expect(input).toBeTruthy();
    expect(html).toContain(`<h2 id="${title}"`);
    expect(html).toContain("Delete service?</h2>");
    expect(html).toContain(`<p id="${description}"`);
    expect(html).toContain("cannot be undone.");
    expect(html).toContain(`<label for="${input}"`);
    expect(html).toContain("to confirm (case-sensitive).");
  });

  it("starts with an empty name, disabled delete, and available cancel", () => {
    const onConfirm = vi.fn(async () => ({ ok: true }));
    const html = renderDialog({ onConfirm });
    const input = html.match(/<input\b[^>]*>/)?.[0];
    const submit = html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
    const cancel = html.match(/<button\b[^>]*type="button"[^>]*>/)?.[0];
    expect(input).toContain('value=""');
    expect(input).toContain('autoComplete="off"');
    expect(submit).toContain('disabled=""');
    expect(cancel).toBeTruthy();
    expect(cancel).not.toContain('disabled=""');
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('role="alert"');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders project counts as a list and explains volume persistence", () => {
    const empty = { kind: "application" as const, env: null, domains: [], mounts: [], deployments: [] };
    const impact = deleteImpact([
      { ...empty, domains: [{}, {}], mounts: [{ type: "volume" }] },
      empty,
      { ...empty, kind: "database" },
    ], 2);
    const html = renderDialog({ resource: "project", impact });
    for (const item of ["2 environments", "3 services", "2 domains", "1 volume"]) {
      expect(html).toContain(`<li>${item}</li>`);
    }
    expect(html).toContain("Named-volume data may persist on the host after deletion.");
  });

  it("renders service configuration, variables, deployments, and mounts", () => {
    const html = renderDialog({ impact: serviceDeleteImpact({
      kind: "application",
      env: "MODE=test\nPORT=8080",
      domains: [{}],
      mounts: [{ type: "volume" }, { type: "bind" }],
      deployments: [{}, {}, {}],
    }) });
    for (const item of [
      "Service configuration and containers", "1 domain", "1 volume", "1 other mount",
      "2 environment variables", "3 deployments",
    ]) {
      expect(html).toContain(`<li>${item}</li>`);
    }
    expect(html).not.toContain("MODE=test");
    expect(html).not.toContain("PORT=8080");
  });

  it("escapes resource names and impact text instead of rendering HTML", () => {
    const html = renderDialog({
      name: '<script>alert("x")</script> & app',
      impact: ["<img src=x>"],
    });
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; app");
    expect(html).toContain("<li>&lt;img src=x&gt;</li>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it("omits the volume notice for a destination deletion", () => {
    const html = renderDialog({
      resource: "destination",
      impact: ["S3 destination configuration", "Backup schedules linked to this destination"],
      volumeNotice: false,
    });
    expect(html).toContain("Delete destination?</h2>");
    expect(html).toContain("<li>S3 destination configuration</li>");
    expect(html).toContain("<li>Backup schedules linked to this destination</li>");
    expect(html).not.toContain("Named-volume data");
  });
});
