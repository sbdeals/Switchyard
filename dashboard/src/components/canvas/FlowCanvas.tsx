"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  Panel,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ServiceReferenceGraph } from "@/lib/service-references";
import type { ProjectNode, Service } from "@/lib/dokploy";
import { serviceAccent } from "@/lib/service-meta";
import { resolveServiceLogo, useTemplateLogos } from "@/lib/service-logo";
import { ServiceNode, type ServiceNodeData } from "@/components/canvas/ServiceNode";
import { QuickDeployMenu } from "@/components/QuickDeployMenu";
import {
  CANVAS_POSITIONS_KEY,
  canvasCenter,
  isCanvasCreateShortcut,
  parsePositions,
  placeService,
  screenToFlowPosition,
  type Point,
  type Positions,
} from "@/lib/canvas-layout";

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

function loadPositions(): Positions {
  if (typeof window === "undefined") return {};
  try {
    return parsePositions(localStorage.getItem(CANVAS_POSITIONS_KEY));
  } catch {
    return {};
  }
}
function savePositions(p: Positions) {
  try {
    localStorage.setItem(CANVAS_POSITIONS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

const nodeTypes = { service: ServiceNode };

export function FlowCanvas({
  services,
  graph,
  onSelect,
  projects,
  onDeployed,
}: {
  services: Service[];
  graph: ServiceReferenceGraph;
  onSelect: (service: Service) => void;
  projects: ProjectNode[];
  onDeployed: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const [creation, setCreation] = useState<{ screen: Point; flow: Point } | null>(null);
  // Keep a just-created position through refreshes, even if storage is disabled.
  const [createdPositions, setCreatedPositions] = useState<Positions>({});

  function openAt(screen: Point) {
    const bounds = canvasRef.current?.querySelector(".react-flow")?.getBoundingClientRect();
    const flow = flowRef.current;
    if (!bounds || !flow) return;
    canvasRef.current?.focus();
    setCreation({ screen, flow: screenToFlowPosition(screen, bounds, flow.getViewport()) });
  }

  // Catalog logos for Railway-style node icons (null while the catalog loads).
  const logos = useTemplateLogos();
  const [hoveredEdge, setHoveredEdge] = useState<{ id: string; x: number; y: number } | null>(null);

  const buildNodes = useCallback(
    (overrides?: Positions): Node[] => {
      const saved = { ...loadPositions(), ...createdPositions, ...(overrides ?? {}) };
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
            data: {
              service,
              logo: resolveServiceLogo(service, logos),
              referenceWarnings: graph.warnings[service.id] ?? [],
              onSelect,
            } as ServiceNodeData,
          });
        });
        rowMaxServices = Math.max(rowMaxServices, svcs.length);
        col++;
      }
      return nodes;
    },
    [services, onSelect, logos, graph.warnings, createdPositions]
  );

  const buildEdges = useCallback(
    (): Edge[] =>
      graph.edges.map((e) => {
        const source = services.find((s) => s.id === e.source);
        const target = services.find((s) => s.id === e.target);
        const inferred = e.kind === "inferred";
        const accent = inferred ? "var(--color-fg-subtle)" : target ? serviceAccent(target) : "#a06bff";
        const description = e.kind === "reference"
          ? `${source?.name} references ${target?.name}: ${e.variables.map((v) => `${target?.name}.${v}`).join(", ")}`
          : `inferred: ${source?.name} mentions ${target?.name} in its env (heuristic)`;
        return {
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          ariaLabel: description,
          label: e.kind === "reference" ? e.variables.join(", ") : undefined,
          labelStyle: { fill: "var(--color-fg)", fontSize: 11 },
          labelBgStyle: { fill: "var(--color-surface)", stroke: "var(--color-border-strong)" },
          labelBgPadding: [6, 4] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: { type: MarkerType.ArrowClosed, color: accent, width: 18, height: 18 },
          deletable: false,
          style: { stroke: accent, strokeWidth: 1.5, strokeDasharray: inferred ? "5 5" : undefined },
        };
      }),
    [graph.edges, services]
  );

  // Saved positions are browser-only. Build nodes in the effect below so server
  // grid positions cannot hydrate over the user's persisted layout.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges());
  const hoveredDescription = edges.find((e) => e.id === hoveredEdge?.id)?.ariaLabel;

  // Re-sync with fresh server data (added/removed services, status changes)
  // while keeping any in-session node positions. Standard React Flow
  // controlled-data pattern.
  useEffect(() => {
    setNodes((curr) => {
      const pos: Positions = {};
      for (const n of curr) if (n.type === "service") pos[n.id] = n.position;
      return buildNodes(pos);
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
      ref={canvasRef}
      role="region"
      aria-label="Service canvas"
      title="Double-click or right-click empty canvas to create a service. Press N to create at the center."
      aria-keyshortcuts="N"
      tabIndex={0}
      onKeyDown={(event) => {
        if (!isCanvasCreateShortcut(event, event.target === event.currentTarget)) return;
        const bounds = canvasRef.current?.querySelector(".react-flow")?.getBoundingClientRect();
        if (!bounds) return;
        event.preventDefault();
        openAt(canvasCenter(bounds));
      }}
      className="h-[calc(100vh-9rem)] w-full overflow-hidden rounded-2xl border border-[var(--color-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
    >
      <ReactFlow
        onInit={(flow) => { flowRef.current = flow; }}
        onPaneClick={() => canvasRef.current?.focus()}
        onDoubleClick={(event) => {
          if (!(event.target instanceof Element) || !event.target.classList.contains("react-flow__pane")) return;
          event.preventDefault();
          openAt({ x: event.clientX, y: event.clientY });
        }}
        onPaneContextMenu={(event) => {
          if (!(event.target instanceof Element) || !event.target.classList.contains("react-flow__pane")) return;
          event.preventDefault();
          openAt({ x: event.clientX, y: event.clientY });
        }}
        zoomOnDoubleClick={false}
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeMouseEnter={(event, edge) => setHoveredEdge({ id: edge.id, x: event.clientX, y: event.clientY })}
        onEdgeMouseMove={(event, edge) => setHoveredEdge({ id: edge.id, x: event.clientX, y: event.clientY })}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
        onMoveStart={() => setHoveredEdge(null)}
        nodeTypes={nodeTypes}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#ffffff2b" />
        {edges.length > 0 && (
          <Panel position="top-left">
            <div aria-label="Connection legend" className="flex gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11px] text-[var(--color-fg-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="w-5 border-t-2 border-[var(--color-fg)]" />
                Reference
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="w-5 border-t-2 border-dashed border-[var(--color-fg-subtle)]" />
                Inferred
              </span>
            </div>
          </Panel>
        )}
        <Controls className="!border-[var(--color-border-strong)] !bg-[var(--color-surface)]" />
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
      {hoveredEdge && hoveredDescription && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs text-[var(--color-fg)] shadow-lg"
          style={{
            left: Math.max(8, Math.min(hoveredEdge.x + 12, window.innerWidth - 332)),
            top: Math.max(8, Math.min(hoveredEdge.y + 12, window.innerHeight - 100)),
          }}
        >
          {hoveredDescription}
        </div>
      )}
      {creation && (
        <QuickDeployMenu
          projects={projects}
          anchor={creation.screen}
          onClose={() => setCreation((current) => current === creation ? null : current)}
          onDeployed={(id) => {
            setCreatedPositions((positions) => placeService(positions, id, creation.flow));
            savePositions(placeService(loadPositions(), id, creation.flow));
            setNodes((curr) => curr.map((node) => node.id === id ? { ...node, position: creation.flow } : node));
            setCreation((current) => current === creation ? null : current);
            onDeployed(id);
          }}
        />
      )}
    </div>
  );
}
