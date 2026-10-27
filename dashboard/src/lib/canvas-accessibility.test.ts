import { createElement, type KeyboardEvent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Node, NodeProps, ReactFlowProps } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Service } from "./dokploy";

const captured = vi.hoisted(() => ({
  flow: {} as ReactFlowProps,
  nodes: null as Node[] | null,
  effects: [] as (() => void)[],
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void) => { captured.effects.push(effect); },
}));

vi.mock("@/components/canvas/CanvasResizeFit", () => ({ CanvasResizeFit: () => null }));

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: ReactFlowProps) => {
    captured.flow = props;
    return createElement("div", null, props.children);
  },
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: (props: { "aria-label"?: string }) => createElement("div", {
    "data-testid": "canvas-controls",
    "aria-label": props["aria-label"],
  }),
  Panel: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  useNodesState: (nodes: Node[]) => {
    captured.nodes ??= nodes;
    return [captured.nodes, (update: Node[] | ((current: Node[]) => Node[])) => {
      captured.nodes = typeof update === "function" ? update(captured.nodes!) : update;
    }, vi.fn()];
  },
  useEdgesState: (edges: unknown) => [edges, vi.fn(), vi.fn()],
}));
vi.mock("@/lib/engines", () => import("./engines"));
vi.mock("@/lib/service-meta", () => import("./service-meta"));
vi.mock("@/lib/service-logo", () => ({
  resolveServiceLogo: () => null,
  useTemplateLogos: () => ({}),
}));
vi.mock("@/components/canvas/ServiceNode", () => import("../components/canvas/ServiceNode"));
vi.mock("@/components/QuickDeployMenu", () => ({ QuickDeployMenu: () => null }));

import { FlowCanvas } from "../components/canvas/FlowCanvas";
import { ServiceNode } from "../components/canvas/ServiceNode";

const service = {
  id: "demo-service",
  kind: "compose",
  name: "demo",
  status: "done",
  runtime: { health: "degraded", running: 1, total: 2 },
  projectName: "Demo",
  environmentName: "test",
} as Service;

function keyboardEvent(key: string, id = service.id, node = true) {
  return {
    key,
    target: {
      classList: { contains: (name: string) => node && name === "react-flow__node" },
      dataset: { id },
    },
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLDivElement>;
}

describe("service canvas accessibility", () => {
  const onSelect = vi.fn();
  let html = "";

  beforeEach(() => {
    onSelect.mockClear();
    captured.nodes = null;
    captured.effects = [];
    const render = () => renderToStaticMarkup(createElement(FlowCanvas, {
      services: [service], edges: [], onSelect, projects: [], onDeployed: vi.fn(),
    }));
    render();
    // Main initializes nodes after mount so hydration cannot overwrite saved
    // browser positions. Flush that effect and render its resulting node state.
    expect(captured.flow.nodes).toEqual([]);
    for (const effect of captured.effects.splice(0)) effect();
    html = render();
  });

  it("puts the button name and status detail on the focusable React Flow node", () => {
    const node = captured.flow.nodes![0];
    expect(node.ariaRole).toBe("button");
    expect(node.ariaLabel).toBe("demo, Compose, Degraded (1/2 containers running) — open details");
    expect(captured.flow.nodesFocusable).not.toBe(false);
    expect(captured.flow.disableKeyboardA11y).not.toBe(true);
    expect(captured.flow.autoPanOnNodeFocus).not.toBe(false);
    expect(node.className).toContain("focus-visible:!outline-2");
    expect(captured.flow.ariaLabelConfig?.["node.a11yDescription.keyboardDisabled"])
      .toContain("Press Enter or Space to open service details.");
  });

  it("names the controls group without naming the roleless internal container", () => {
    expect(html).toContain('role="group" aria-label="Canvas controls"><div data-testid="canvas-controls" aria-label=""');
  });

  it("keeps the Tidy up action alongside the accessible canvas controls", () => {
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>.*Tidy up<\/button>/);
    expect(captured.flow.nodesDraggable).toBe(true);
  });

  it("does not add another button or tab stop inside the node", () => {
    const html = renderToStaticMarkup(createElement(ServiceNode, {
      data: { service, logo: null },
      selected: false,
    } as NodeProps & { data: { service: Service; logo: null } }));
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("tabindex=");
  });

  it.each(["Enter", " "])("opens the focused service with %j", (key) => {
    const event = keyboardEvent(key);
    captured.flow.onKeyDown!(event);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(service);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves arrow movement, other controls, and missing services alone", () => {
    for (const event of [
      keyboardEvent("ArrowRight"),
      keyboardEvent("Escape"),
      keyboardEvent("Enter", service.id, false),
      keyboardEvent("Enter", "missing-service"),
    ]) {
      captured.flow.onKeyDown!(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the same service when its node is clicked", () => {
    captured.flow.onNodeClick!({} as never, captured.flow.nodes![0]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(service);
  });
});
