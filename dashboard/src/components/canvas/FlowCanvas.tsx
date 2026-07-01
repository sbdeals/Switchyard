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
  type NodeProps,
  useNodesState,
  useEdgesState,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Service, ServiceEdge } from "@/lib/dokploy";
import { serviceAccent } from "@/lib/service-meta";
import { ServiceNode, type ServiceNodeData } from "@/components/canvas/ServiceNode";

const POS_KEY = "switchyard:positions";
const COL_W = 320;
const ROW_H = 104;

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

function GroupLabel({ data }: NodeProps & { data: { label: string } }) {
  return (
    <div className="select-none text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
      {data.label}
    </div>
  );
}

const nodeTypes = { service: ServiceNode, label: GroupLabel };

export function FlowCanvas({
  services,
  edges: serviceEdges,
  onSelect,
}: {
  services: Service[];
  edges: ServiceEdge[];
  onSelect: (service: Service) => void;
}) {
  const buildNodes = useCallback(
    (overrides?: Positions): Node[] => {
      const saved = { ...loadPositions(), ...(overrides ?? {}) };
      // Group by project / environment for a tidy default layout.
      const groups = new Map<string, Service[]>();
      for (const svc of services) {
        const key = `${svc.projectName} / ${svc.environmentName}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(svc);
      }
      const nodes: Node[] = [];
      let col = 0;
      for (const [label, svcs] of groups) {
        const x = col * COL_W;
        nodes.push({
          id: `label:${label}`,
          type: "label",
          position: { x, y: -40 },
          data: { label },
          draggable: false,
          selectable: false,
        });
        svcs.forEach((service, row) => {
          nodes.push({
            id: service.id,
            type: "service",
            position: saved[service.id] ?? { x, y: row * ROW_H },
            data: { service, onSelect } as ServiceNodeData,
          });
        });
        col++;
      }
      return nodes;
    },
    [services, onSelect]
  );

  const buildEdges = useCallback(
    (): Edge[] =>
      serviceEdges.map((e) => {
        const target = services.find((s) => s.id === e.target);
        const accent = target ? serviceAccent(target) : "#a06bff";
        return {
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          animated: true,
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
      // Persist positions after a drag. Rebuilding from the current nodes (not
      // merging into the stored map) also prunes entries for deleted services.
      const moved = changes.some((c) => c.type === "position" && !c.dragging);
      if (moved) {
        setNodes((curr) => {
          const pos: Positions = {};
          for (const n of curr) if (n.type === "service") pos[n.id] = n.position;
          savePositions(pos);
          return curr;
        });
      }
    },
    [onNodesChange, setNodes]
  );

  return (
    <div className="h-[calc(100vh-9rem)] w-full overflow-hidden rounded-2xl border border-[var(--color-border)]">
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
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#26263a" />
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
