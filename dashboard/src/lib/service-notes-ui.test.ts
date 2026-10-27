import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ServiceNotes } from "../components/service/ServiceNotes";
import { ServiceNode } from "../components/canvas/ServiceNode";
import type { ComposeService } from "./dokploy";

vi.mock("@/lib/client-actions", () => ({ saveServiceNotesAction: vi.fn() }));
vi.mock("@/components/service/primitives", () => ({ inputCls: "" }));
vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}));

function renderNode(description: string | null, dockerImage: string | null = null) {
  const service: ComposeService = {
    kind: "compose",
    id: "service-notes-compose",
    name: "service-notes-compose",
    description,
    appName: "service-notes-compose",
    status: "idle",
    projectId: "service-notes-project",
    projectName: "Notes",
    environmentId: "service-notes-environment",
    environmentName: "Test",
    dockerImage,
    env: null,
    createdAt: null,
    cpuLimit: null,
    memoryLimit: null,
    replicas: null,
    composeFile: null,
    composeType: null,
    domains: [],
    deployments: [],
  };
  return renderToStaticMarkup(createElement(ServiceNode, {
    id: service.id,
    type: "service",
    data: { service, logo: null, onSelect: vi.fn() },
    selected: false,
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: false,
    draggable: true,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  }));
}

describe("service notes rendering", () => {
  it.each([null, ""])("offers an accessible edit button for empty notes (%s)", (description) => {
    const html = renderToStaticMarkup(createElement(ServiceNotes, { id: "notes", description }));
    expect(html).toContain('aria-label="Edit service notes"');
    expect(html).toContain("Add a description…</button>");
    expect(html).toContain('role="status" aria-live="polite"');
  });

  it("renders multiline descriptions as plain text", () => {
    const description = '<script>alert("notes")</script>\n**plain text** & details';
    const html = renderToStaticMarkup(createElement(ServiceNotes, { id: "notes", description }));
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain('&lt;script&gt;alert(&quot;notes&quot;)&lt;/script&gt;\n**plain text** &amp; details');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<strong>");
  });
});

describe("canvas service notes", () => {
  it("shows only the first line in a muted, truncated subtitle with the full note as its tooltip", () => {
    const html = renderNode("Primary purpose\nOperational details");
    expect(html).toContain('title="Primary purpose\nOperational details" class="truncate text-[11px] text-[var(--color-fg-muted)]">Primary purpose</div>');
    expect(html).not.toContain(">Operational details</div>");
  });

  it("escapes HTML in the subtitle and full-text tooltip", () => {
    const html = renderNode('<script>alert("notes")</script>\nSecond & "quoted" line');
    expect(html).toContain('title="&lt;script&gt;alert(&quot;notes&quot;)&lt;/script&gt;\nSecond &amp; &quot;quoted&quot; line"');
    expect(html).toContain(">&lt;script&gt;alert(&quot;notes&quot;)&lt;/script&gt;</div>");
    expect(html).not.toContain("<script>");
  });

  it.each([null, "", " \r\n "])("keeps the service label when notes are empty (%s)", (description) => {
    const html = renderNode(description);
    expect(html).toContain('<div class="truncate text-[11px] text-[var(--color-fg-muted)]">Compose</div>');
  });

  it("keeps the image subtitle when notes are absent", () => {
    const html = renderNode(null, "nginx:alpine");
    expect(html).toContain('<div class="truncate text-[11px] text-[var(--color-fg-muted)]">nginx:alpine</div>');
  });
});
