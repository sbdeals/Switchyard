"use client";

import { useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Service, ServiceEdge } from "@/lib/dokploy";
import { serviceAccent } from "@/lib/service-meta";
import { resolveServiceLogo, useTemplateLogos } from "@/lib/service-logo";
import { ServiceNode, type ServiceNodeData } from "@/components/canvas/ServiceNode";

// v2: key bumped when the default layout became a grid — pre-grid saves froze
// every auto-position (not just drags), which would pin the old horizontal
// layout forever.
const POS_KEY = "switchyard:positions:v2";
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

type Positions = Record<string, { x: number; y: number }>;

function loadPositions(): Positions {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function savePositions(p: Positions) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

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
      const saved = { ...loadPositions(), ...(overrides ?? {}) };
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
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#ffffff2b" />
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
    </div>
  );
}
