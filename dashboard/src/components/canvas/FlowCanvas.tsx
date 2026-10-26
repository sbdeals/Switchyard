"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, Undo2 } from "lucide-react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Service, ServiceEdge } from "@/lib/dokploy";
import { serviceAccent } from "@/lib/service-meta";
import { resolveServiceLogo, useTemplateLogos } from "@/lib/service-logo";
import { ServiceNode, type ServiceNodeData } from "@/components/canvas/ServiceNode";
import { canvasAutoLayout, type Positions } from "@/lib/canvas-auto-layout";
import {
  createCanvasLayoutActions,
  loadPositions,
  positionsForCanvasSync,
  savePositions,
} from "@/lib/canvas-layout-actions";

const COL_W = 300;
const ROW_H = 104;
/**
 * Group-columns per grid row. With one column per project, an unbounded row
 * turns a dozen projects into a horizontal strip; wrapping at 4 keeps the
 * default view roughly viewport-shaped without letting tall groups (many
 * services) dominate the fold.
 */
const GRID_COLS = 4;
/** Vertical padding between grid rows — room for the next row's group label. */
const ROW_GAP = 72;

const nodeTypes = { service: ServiceNode };

export function FlowCanvas({
  services,
  edges: serviceEdges,
  onSelect,
}: {
  services: Service[];
  edges: ServiceEdge[];
  onSelect: (service: Service) => void;
}) {
  // Catalog logos for Railway-style node icons (null while the catalog loads).
  const logos = useTemplateLogos();

  const buildNodes = useCallback(
    (overrides?: Positions): Node[] => {
      const saved = overrides ?? {};
      // Group by project / environment for a tidy default layout. The group
      // name renders inside each card (nodes are draggable — a label pinned to
      // the background would stay behind when its services move).
      const groups = new Map<string, Service[]>();
      for (const svc of services) {
        const key = `${svc.projectName} / ${svc.environmentName}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(svc);
      }
      const nodes: Node[] = [];
      // Grid default layout: groups wrap after GRID_COLS columns instead of
      // stretching into one endless horizontal row. Each grid row starts below
      // the tallest group of the previous row. Sorted so the grid is stable
      // across reloads (Map order follows the fetch, which can vary).
      const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
      let col = 0;
      let rowY = 0;
      let rowMaxServices = 0;
      for (const [, svcs] of ordered) {
        if (col === GRID_COLS) {
          rowY += rowMaxServices * ROW_H + ROW_GAP;
          col = 0;
          rowMaxServices = 0;
        }
        const x = col * COL_W;
        svcs.forEach((service, row) => {
          nodes.push({
            id: service.id,
            type: "service",
            position: saved[service.id] ?? { x, y: rowY + row * ROW_H },
            data: { service, logo: resolveServiceLogo(service, logos), onSelect } as ServiceNodeData,
          });
        });
        rowMaxServices = Math.max(rowMaxServices, svcs.length);
        col++;
      }
      return nodes;
    },
    [services, onSelect, logos]
  );

  const buildEdges = useCallback(
    (): Edge[] =>
      serviceEdges.map((e) => {
        const source = services.find((s) => s.id === e.source);
        const target = services.find((s) => s.id === e.target);
        const accent = target ? serviceAccent(target) : "#a06bff";
        return {
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          animated: true,
          ariaLabel:
            source && target ? `${source.name} connects to ${target.name}` : undefined,
          style: { stroke: accent, strokeWidth: 1.5 },
        };
      }),
    [serviceEdges, services]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges());
  const flow = useRef<ReactFlowInstance | null>(null);
  const layoutActions = useRef<ReturnType<typeof createCanvasLayoutActions> | null>(null);
  const positionsLoaded = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const actions = createCanvasLayoutActions({
      getPositions: () => Object.fromEntries(
        (flow.current?.getNodes() ?? []).map((node) => [node.id, node.position])
      ),
      setPositions: (positions) => setNodes((current) => current.map((node) => (
        positions[node.id] ? { ...node, position: positions[node.id] } : node
      ))),
      onUndoAvailable: setCanUndo,
      onAnimating: setAnimating,
      onSettled: () => {
        void flow.current?.fitView({
          padding: 0.3,
          maxZoom: 1,
          duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200,
        });
      },
    });
    layoutActions.current = actions;
    return () => actions.dispose();
  }, [setNodes]);

  const tidyUp = () => {
    const current = flow.current?.getNodes();
    if (!current?.length) return;
    const positions = canvasAutoLayout(current.map((node) => {
      const { service } = node.data as ServiceNodeData;
      return {
        id: node.id,
        name: service.name,
        kind: service.kind,
        width: node.measured?.width,
        height: node.measured?.height,
      };
    }), serviceEdges);
    layoutActions.current?.tidy(positions);
  };

  // Re-sync with fresh server data (added/removed services, status changes)
  // while keeping any in-session node positions. Standard React Flow
  // controlled-data pattern.
  useEffect(() => {
    // Restore browser storage after hydration. Reading it during the first
    // render disagrees with the server's default positions.
    const preserveCurrent = positionsLoaded.current;
    positionsLoaded.current = true;
    setNodes((curr) => {
      const current = curr.filter((node) => node.type === "service");
      return buildNodes(positionsForCanvasSync(current, preserveCurrent));
    });
    setEdges(buildEdges());
  }, [buildNodes, buildEdges, setNodes, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      // Persist positions after a drag — but only the nodes the user actually
      // dragged. Saving every node's position (the old behavior) froze the
      // auto-layout into localStorage, so default-layout improvements never
      // applied to returning users. Stale entries for deleted services are
      // pruned against the current node set.
      const draggedIds = changes
        .filter((c) => c.type === "position" && !c.dragging)
        .map((c) => (c as { id: string }).id);
      if (draggedIds.length > 0) {
        setNodes((curr) => {
          const pos = loadPositions();
          for (const id of draggedIds) {
            const n = curr.find((n) => n.id === id && n.type === "service");
            if (n) pos[id] = n.position;
          }
          const live = new Set(curr.filter((n) => n.type === "service").map((n) => n.id));
          for (const id of Object.keys(pos)) if (!live.has(id)) delete pos[id];
          savePositions(pos);
          return curr;
        });
      }
    },
    [onNodesChange, setNodes]
  );

  return (
    <div
      role="region"
      aria-label="Service canvas"
      className="h-[calc(100vh-9rem)] w-full overflow-hidden rounded-2xl border border-[var(--color-border)]"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onInit={(instance) => { flow.current = instance; }}
        nodesDraggable={!animating}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#ffffff2b" />
        <Controls className="!border-[var(--color-border-strong)] !bg-[var(--color-surface)]" />
        <Panel position="top-right">
          <button
            type="button"
            onClick={tidyUp}
            disabled={animating || nodes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] disabled:opacity-50"
          >
            <LayoutGrid className="size-3.5" /> Tidy up
          </button>
        </Panel>
        {canUndo && (
          <Panel position="bottom-center">
            <div
              role="status"
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs shadow-lg"
            >
              <span>Canvas tidied up</span>
              <button
                type="button"
                onClick={() => layoutActions.current?.undo()}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-[var(--color-brand)] hover:bg-[var(--color-surface-hover)]"
              >
                <Undo2 className="size-3.5" /> Undo
              </button>
            </div>
          </Panel>
        )}
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            n.type === "service"
              ? serviceAccent((n.data as ServiceNodeData).service)
              : "transparent"
          }
          maskColor="#0a0a0fcc"
          className="!bg-[var(--color-bg-elevated)]"
        />
      </ReactFlow>
    </div>
  );
}
