import type { Positions } from "./canvas-layout";

export type LayoutNode = {
  id: string;
  name: string;
  kind?: string;
  width?: number;
  height?: number;
};

const COLUMN_GAP = 80;
const ROW_GAP = 40;
const GROUP_GAP = 96;

/** Lay out services without reading or changing the canvas's saved positions. */
export function canvasAutoLayout(
  nodes: readonly LayoutNode[],
  edges: readonly { source: string; target: string }[]
): Positions {
  const ordered = [...nodes].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
  const byId = new Map(ordered.map((node) => [node.id, node]));
  const outgoing = new Map(ordered.map((node) => [node.id, new Set<string>()]));
  const connected = new Set<string>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    outgoing.get(edge.source)!.add(edge.target);
    connected.add(edge.source);
    connected.add(edge.target);
  }

  // Tarjan's strongly connected components keep cycles in a single layer.
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const component = new Map<string, number>();
  let componentCount = 0;
  function visit(id: string) {
    indices.set(id, indices.size);
    low.set(id, indices.get(id)!);
    stack.push(id);
    onStack.add(id);
    for (const target of outgoing.get(id)!) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, indices.get(target)!));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.set(member, componentCount);
    } while (member !== id);
    componentCount++;
  }
  for (const node of ordered) {
    if (!indices.has(node.id)) visit(node.id);
  }

  // Longest-path ranks on the acyclic component graph put dependents to the right.
  const successors = Array.from({ length: componentCount }, () => new Set<number>());
  const incoming = Array<number>(componentCount).fill(0);
  const ranks = Array<number>(componentCount).fill(0);
  for (const [source, targets] of outgoing) {
    for (const target of targets) {
      const from = component.get(source)!;
      const to = component.get(target)!;
      if (from !== to && !successors[from].has(to)) {
        successors[from].add(to);
        incoming[to]++;
      }
    }
  }
  const ready = incoming.flatMap((count, index) => (count === 0 ? [index] : []));
  for (let index = 0; index < ready.length; index++) {
    const from = ready[index];
    for (const to of successors[from]) {
      ranks[to] = Math.max(ranks[to], ranks[from] + 1);
      if (--incoming[to] === 0) ready.push(to);
    }
  }

  const width = (node: LayoutNode) => Math.max(1, node.width ?? 240);
  const height = (node: LayoutNode) => Math.max(1, node.height ?? 80);
  const positions: Positions = {};
  const layers = new Map<number, LayoutNode[]>();
  const isolated: LayoutNode[] = [];
  const databases: LayoutNode[] = [];
  for (const node of ordered) {
    if (node.kind === "database") {
      databases.push(node);
    } else if (!connected.has(node.id)) {
      isolated.push(node);
    } else {
      const rank = ranks[component.get(node.id)!];
      const layer = layers.get(rank) ?? [];
      layer.push(node);
      layers.set(rank, layer);
    }
  }

  let bottom = 0;
  let x = 0;
  for (const [, layer] of [...layers.entries()].sort(([a], [b]) => a - b)) {
    let y = 0;
    for (const node of layer) {
      positions[node.id] = { x, y };
      bottom = Math.max(bottom, y + height(node));
      y += height(node) + ROW_GAP;
    }
    x += Math.max(...layer.map(width)) + COLUMN_GAP;
  }

  function placeGrid(group: LayoutNode[]) {
    if (!group.length) return;
    const columns = Math.ceil(Math.sqrt(group.length));
    const widths = Array<number>(columns).fill(0);
    group.forEach((node, index) => {
      const column = index % columns;
      widths[column] = Math.max(widths[column], width(node));
    });
    let y = bottom ? bottom + GROUP_GAP : 0;
    for (let row = 0; row < group.length; row += columns) {
      let x = 0;
      let rowHeight = 0;
      for (let column = 0; column < columns && row + column < group.length; column++) {
        const node = group[row + column];
        positions[node.id] = { x, y };
        rowHeight = Math.max(rowHeight, height(node));
        x += widths[column] + COLUMN_GAP;
      }
      bottom = y + rowHeight;
      y = bottom + ROW_GAP;
    }
  }
  placeGrid(isolated);
  // A bottom band keeps all databases together even when their edges point outward.
  placeGrid(databases);
  return positions;
}
