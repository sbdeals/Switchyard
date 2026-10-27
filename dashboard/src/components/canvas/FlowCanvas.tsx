"use client";

import { Copy } from "lucide-react";
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
import { applySelectionChanges } from "@/lib/bulk-selection";
import type { ProjectNode, Service, ServiceEdge } from "@/lib/dokploy";
import { serviceAccent } from "@/lib/service-meta";
import { resolveServiceLogo, useTemplateLogos } from "@/lib/service-logo";
import { ServiceNode, type ServiceNodeData } from "@/components/canvas/ServiceNode";
import { useDialogFocus } from "@/components/use-focus-trap";
import { useTheme } from "@/components/ThemeProvider";
import { CanvasResizeFit } from "@/components/canvas/CanvasResizeFit";
import { canvasAutoLayout } from "@/lib/canvas-auto-layout";
import {
  createCanvasLayoutActions,
  loadPositions,
  positionsForCanvasSync,
  savePositions,
} from "@/lib/canvas-layout-actions";
import { QuickDeployMenu } from "@/components/QuickDeployMenu";
import {
  CANVAS_ROW_HEIGHT as ROW_H,
  canvasCenter,
  isCanvasCreateShortcut,
  mergeNodePositions,
  placeService,
  screenToFlowPosition,
  type Point,
  type Positions,
} from "@/lib/canvas-layout";

const COL_W = 300;
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
  onDuplicate,
  selectedIds,
  onSelectionChange,
  selectionDisabled = false,
  projects,
  onDeployed,
}: {
  services: Service[];
  edges: ServiceEdge[];
  onSelect: (service: Service) => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  selectionDisabled?: boolean;
  onDuplicate: (service: Service) => void;
  projects: ProjectNode[];
  onDeployed: (id: string) => void;
}) {
  const { theme } = useTheme();
  const [menu, setMenu] = useState<{ service: Service; x: number; y: number } | null>(null);
  const menuRef = useDialogFocus<HTMLDivElement>(() => setMenu(null));
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
  const selectedIdsRef = useRef(selectedIds);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const buildNodes = useCallback(
    (overrides: Positions, current: Node[] = []): Node[] => {
      const saved = { ...loadPositions(), ...createdPositions, ...overrides };
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
            selected: selectedIds.includes(service.id),
            position: { x, y: rowY + row * ROW_H },
            data: { service, logo: resolveServiceLogo(service, logos), onSelect } as ServiceNodeData,
          });
        });
        rowMaxServices = Math.max(rowMaxServices, svcs.length);
        col++;
      }
      return mergeNodePositions(nodes, saved, current);
    },
    [services, onSelect, logos, selectedIds, createdPositions]
  );

  const buildEdges = useCallback(
    (): Edge[] =>
      serviceEdges.map((e) => {
        const source = services.find((s) => s.id === e.source);
        const target = services.find((s) => s.id === e.target);
        const accent = target ? serviceAccent(target) : "var(--color-brand)";
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

  // Saved positions are browser-only. Build nodes in the effect below so server
  // grid positions cannot hydrate over the user's persisted layout.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges());
  const layoutActions = useRef<ReturnType<typeof createCanvasLayoutActions> | null>(null);
  const positionsLoaded = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const actions = createCanvasLayoutActions({
      getPositions: () => Object.fromEntries(
        (flowRef.current?.getNodes() ?? []).map((node) => [node.id, node.position])
      ),
      setPositions: (positions) => setNodes((current) => current.map((node) => (
        positions[node.id] ? { ...node, position: positions[node.id] } : node
      ))),
      onUndoAvailable: setCanUndo,
      onAnimating: setAnimating,
      onSettled: () => {
        void flowRef.current?.fitView({
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
    const current = flowRef.current?.getNodes();
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
  // while keeping in-session positions, including Tidy/Undo and active drags.
  useEffect(() => {
    // Restore browser storage after hydration. Reading it during the first
    // render disagrees with the server's default positions.
    const preserveCurrent = positionsLoaded.current;
    positionsLoaded.current = true;
    setNodes((curr) => {
      const current = curr.filter((node) => node.type === "service");
      return buildNodes(positionsForCanvasSync(current, preserveCurrent), preserveCurrent ? current : []);
    });
    setEdges(buildEdges());
  }, [buildNodes, buildEdges, setNodes, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const allowed = selectionDisabled
        ? changes.filter((change) => change.type !== "select")
        : changes;
      onNodesChange(allowed);
      const selectionChanges = allowed.filter((change) => change.type === "select");
      if (selectionChanges.length > 0) {
        selectedIdsRef.current = applySelectionChanges(selectedIdsRef.current, selectionChanges);
        onSelectionChange(selectedIdsRef.current);
      }
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
    [onNodesChange, setNodes, onSelectionChange, selectionDisabled]
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
      className="relative h-[calc(100vh-9rem)] w-full overflow-hidden rounded-2xl border border-[var(--color-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
    >
      <p className="pointer-events-none absolute left-3 top-3 z-10 rounded-lg bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-fg-muted)]">
        Shift-drag or Shift/Ctrl/⌘-click to select services
      </p>
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
        onNodeDragStop={(_, _node, draggedNodes) => {
          // A later drag supersedes a quick-deploy placement, including when
          // localStorage is unavailable and only the in-memory placement exists.
          setCreatedPositions((positions) => draggedNodes.reduce((updated, node) =>
            Object.hasOwn(updated, node.id)
              ? placeService(updated, node.id, node.position)
              : updated, positions));
        }}
        onEdgesChange={onEdgesChange}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          setMenu({
            service: (node.data as ServiceNodeData).service,
            x: Math.min(event.clientX, window.innerWidth - 200),
            y: Math.min(event.clientY, window.innerHeight - 52),
          });
        }}
        onMoveStart={() => setMenu(null)}
        nodeTypes={nodeTypes}
        elementsSelectable={!selectionDisabled}
        multiSelectionKeyCode={["Shift", "Control", "Meta"]}
        selectionKeyCode={selectionDisabled ? null : "Shift"}
        deleteKeyCode={null}
        nodesDraggable={!animating}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <CanvasResizeFit />
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="var(--color-canvas-dots)" bgColor="var(--color-bg)" />
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
          maskColor="var(--color-canvas-mask)"
          className="!bg-[var(--color-bg-elevated)]"
        />
      </ReactFlow>
      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} onContextMenu={(event) => {
            event.preventDefault();
            setMenu(null);
          }} />
          <div
            ref={menuRef}
            role="menu"
            aria-label={`${menu.service.name} actions`}
            style={{ left: menu.x, top: menu.y }}
            className="fixed z-40 w-48 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              data-autofocus
              onClick={() => {
                onDuplicate(menu.service);
                setMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
            >
              <Copy className="size-3.5" /> Duplicate service
            </button>
          </div>
        </>
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
