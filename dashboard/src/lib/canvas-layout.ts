import type { Node, Rect, Viewport, XYPosition } from "@xyflow/react";

export type Positions = Record<string, XYPosition>;
export type CanvasSize = { width: number; height: number };

export const CANVAS_ROW_HEIGHT = 104;
const NODE_GAP = 24;

function nodeRect(node: Node): Rect {
  return {
    ...node.position,
    // ServiceNode is w-60; use its measured size once React Flow has it.
    width: node.measured?.width ?? node.width ?? 240,
    height: node.measured?.height ?? node.height ?? 80,
  };
}

function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
  );
}

/** Saved drags beat hydrated defaults; only an ongoing drag takes precedence. */
export function mergeNodePositions<T extends Node>(
  defaults: T[],
  saved: Positions,
  current: T[] = []
): T[] {
  const previous = new Map(current.map((node) => [node.id, node]));
  const positions = new Map<string, XYPosition>();
  const occupied: Rect[] = [];

  // Reserve saved/dragged positions first, even if a new service sorts ahead
  // of them. Deleted services' saved positions do not reserve space.
  for (const node of defaults) {
    const prior = previous.get(node.id);
    const stored = saved?.[node.id];
    const validStored = stored && Number.isFinite(stored.x) && Number.isFinite(stored.y);
    const position = prior?.dragging
      ? prior.position
      : validStored ? stored : undefined;
    if (position) {
      positions.set(node.id, position);
      occupied.push(nodeRect({ ...prior, ...node, position }));
    }
  }

  const automatic = defaults.filter((node) => !positions.has(node.id));
  const existing = automatic.filter((node) => previous.has(node.id));
  const added = automatic.filter((node) => !previous.has(node.id));
  // Prefer existing automatic positions before placing new services. A saved
  // drag can occupy a hydrated default, so check those for collisions too.
  for (const node of [...existing, ...added]) {
    const prior = previous.get(node.id);
    const rect = nodeRect({ ...prior, ...node, position: prior?.position ?? node.position });
    // Keep the group's column, moving down to the next unoccupied grid slot.
    while (occupied.some((other) => overlaps(rect, other, NODE_GAP))) {
      rect.y += CANVAS_ROW_HEIGHT;
    }
    positions.set(node.id, { x: rect.x, y: rect.y });
    occupied.push(rect);
  }

  // Keep measurements, selection and dragging state during data refreshes.
  return defaults.map((node) => ({
    ...previous.get(node.id),
    ...node,
    position: positions.get(node.id)!,
  }));
}

export function hasSignificantCanvasResize(previous: CanvasSize, next: CanvasSize): boolean {
  return (
    previous.width > 0 && previous.height > 0 && next.width > 0 && next.height > 0 &&
    (Math.abs(next.width - previous.width) >= Math.max(120, previous.width * 0.2) ||
      Math.abs(next.height - previous.height) >= Math.max(120, previous.height * 0.2))
  );
}

/** Recover an empty viewport after a large resize without overriding navigation. */
export function shouldRefitCanvas({
  previous,
  next,
  nodes,
  viewport,
  interacting,
}: {
  previous: CanvasSize;
  next: CanvasSize;
  nodes: Node[];
  viewport: Viewport;
  interacting: boolean;
}): boolean {
  if (interacting || !hasSignificantCanvasResize(previous, next)) return false;
  const visibleNodes = nodes.filter((node) => !node.hidden);
  if (visibleNodes.length === 0) return false;
  const view = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: next.width / viewport.zoom,
    height: next.height / viewport.zoom,
  };
  // Test individual cards: the space between distant groups can be empty even
  // when the viewport intersects the overall graph bounds.
  return !visibleNodes.some((node) => overlaps(nodeRect(node), view));
}
