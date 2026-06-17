"use client";

import { useCallback, useMemo } from "react";
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
import type { Database, ServiceEdge } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
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
  databases,
  edges: serviceEdges,
  onSelect,
}: {
  databases: Database[];
  edges: ServiceEdge[];
  onSelect: (db: Database) => void;
}) {
  const initialNodes = useMemo<Node[]>(() => {
    const saved = loadPositions();
    // Group by project / environment for a tidy default layout.
    const groups = new Map<string, Database[]>();
    for (const db of databases) {
      const key = `${db.projectName} / ${db.environmentName}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(db);
    }
    const nodes: Node[] = [];
    let col = 0;
    for (const [label, dbs] of groups) {
      const x = col * COL_W;
      nodes.push({
        id: `label:${label}`,
        type: "label",
        position: { x, y: -40 },
        data: { label },
        draggable: false,
        selectable: false,
      });
      dbs.forEach((db, row) => {
        nodes.push({
          id: db.id,
          type: "service",
          position: saved[db.id] ?? { x, y: row * ROW_H },
          data: { db, onSelect } as ServiceNodeData,
        });
      });
      col++;
    }
    return nodes;
  }, [databases, onSelect]);

  const initialEdges = useMemo<Edge[]>(
    () =>
      serviceEdges.map((e) => {
        const accent = ENGINE_META[databases.find((d) => d.id === e.target)?.engine ?? "postgres"].accent;
        return {
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          animated: true,
          style: { stroke: accent, strokeWidth: 1.5 },
        };
      }),
    [serviceEdges, databases]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      // Persist positions after a drag.
      const moved = changes.some((c) => c.type === "position" && !c.dragging);
      if (moved) {
        setNodes((curr) => {
          const pos: Positions = loadPositions();
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
              ? ENGINE_META[(n.data as ServiceNodeData).db.engine].accent
              : "transparent"
          }
          maskColor="#0a0a0fcc"
          className="!bg-[var(--color-bg-elevated)]"
        />
      </ReactFlow>
    </div>
  );
}
