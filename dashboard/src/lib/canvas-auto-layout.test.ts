import { describe, expect, it } from "vitest";
import { canvasAutoLayout, type LayoutNode, type Positions } from "./canvas-auto-layout";

const service = (id: string, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id,
  name: id,
  ...extra,
});
const edge = (source: string, target: string) => ({ source, target });

function expectNoOverlaps(nodes: LayoutNode[], positions: Positions) {
  expect(Object.keys(positions).sort()).toEqual(nodes.map((node) => node.id).sort());
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (const b of nodes.slice(i + 1)) {
      const first = positions[a.id];
      const second = positions[b.id];
      const separate =
        first.x + (a.width ?? 240) <= second.x ||
        second.x + (b.width ?? 240) <= first.x ||
        first.y + (a.height ?? 80) <= second.y ||
        second.y + (b.height ?? 80) <= first.y;
      expect(separate, `${a.id} and ${b.id} must not overlap`).toBe(true);
    }
  }
}

describe("canvasAutoLayout", () => {
  it("places a chain from source to dependent, independent of alphabetical order", () => {
    const nodes = [service("web"), service("api"), service("worker")];
    const positions = canvasAutoLayout(nodes, [edge("web", "api"), edge("api", "worker")]);
    expect(positions.web.x).toBeLessThan(positions.api.x);
    expect(positions.api.x).toBeLessThan(positions.worker.x);
    expect(positions.web.y).toBe(positions.api.y);
    expectNoOverlaps(nodes, positions);
  });

  it("stacks fan-out dependents alphabetically in the next layer", () => {
    const nodes = [service("web"), service("worker"), service("api")];
    const positions = canvasAutoLayout(nodes, [edge("web", "worker"), edge("web", "api")]);
    expect(positions.api.x).toBe(positions.worker.x);
    expect(positions.api.x).toBeGreaterThan(positions.web.x);
    expect(positions.api.y).toBeLessThan(positions.worker.y);
    expectNoOverlaps(nodes, positions);
  });

  it("puts a shared dependent after the longest incoming path", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => service(id));
    const positions = canvasAutoLayout(nodes, [
      edge("a", "d"), edge("a", "b"), edge("b", "c"), edge("c", "d"),
    ]);
    expect(positions.d.x).toBeGreaterThan(positions.c.x);
    expectNoOverlaps(nodes, positions);
  });

  it("collapses cycles into one ordered layer and retains incoming and outgoing layers", () => {
    const nodes = ["source", "b", "a", "c", "target"].map((id) => service(id));
    const positions = canvasAutoLayout(nodes, [
      edge("source", "a"), edge("a", "b"), edge("b", "c"), edge("c", "a"),
      edge("b", "target"), edge("target", "target"),
    ]);
    expect(positions.source.x).toBeLessThan(positions.a.x);
    expect(positions.a.x).toBe(positions.b.x);
    expect(positions.b.x).toBe(positions.c.x);
    expect(positions.a.y).toBeLessThan(positions.b.y);
    expect(positions.b.y).toBeLessThan(positions.c.y);
    expect(positions.c.x).toBeLessThan(positions.target.x);
    expectNoOverlaps(nodes, positions);
  });

  it("places disconnected services in a compact grid sorted by name then id", () => {
    const nodes = [service("z", { name: "Alpha" }), service("a", { name: "Alpha" }),
      service("b", { name: "Beta" }), service("c", { name: "Charlie" }), service("d")];
    const positions = canvasAutoLayout(nodes, []);
    expect(positions.a).toEqual({ x: 0, y: 0 });
    expect(positions.z.y).toBe(0);
    expect(positions.z.x).toBeGreaterThan(positions.a.x);
    expect(new Set(Object.values(positions).map((position) => position.x)).size).toBe(3);
    expect(new Set(Object.values(positions).map((position) => position.y)).size).toBe(2);
    expectNoOverlaps(nodes, positions);
  });

  it("keeps isolated services below connected layers and databases together at the bottom", () => {
    const nodes = [service("web"), service("api"), service("isolated"),
      service("postgres", { kind: "database" }), service("redis", { kind: "database" })];
    const positions = canvasAutoLayout(nodes, [
      edge("web", "api"), edge("api", "postgres"), edge("redis", "web"),
    ]);
    expect(positions.api.x).toBeGreaterThan(positions.web.x);
    expect(positions.isolated.y).toBeGreaterThan(positions.api.y + 80);
    expect(positions.postgres.y).toBeGreaterThan(positions.isolated.y + 80);
    expect(positions.redis.y).toBe(positions.postgres.y);
    expect(positions.postgres.x).toBeLessThan(positions.redis.x);
    expectNoOverlaps(nodes, positions);
  });

  it("reserves the provided sizes in layers and both grids", () => {
    const nodes = [service("a", { width: 600, height: 180 }),
      service("b", { width: 380, height: 300 }), service("c", { height: 160 }),
      service("island-a", { width: 900, height: 240 }), service("island-b"),
      service("island-c", { height: 450 }), service("island-d"),
      service("db-a", { kind: "database", width: 700, height: 200 }),
      service("db-b", { kind: "database" }), service("db-c", { kind: "database" })];
    const positions = canvasAutoLayout(nodes, [edge("a", "b"), edge("a", "c")]);
    expectNoOverlaps(nodes, positions);
  });

  it("ignores dangling edges and duplicate edges", () => {
    const nodes = [service("a"), service("b"), service("c")];
    expect(canvasAutoLayout(nodes, [edge("missing", "a"), edge("a", "missing")]))
      .toEqual(canvasAutoLayout(nodes, []));
    expect(canvasAutoLayout(nodes, [edge("a", "b"), edge("a", "b")]))
      .toEqual(canvasAutoLayout(nodes, [edge("a", "b")]));
    expect(canvasAutoLayout([], [edge("missing", "absent")])).toEqual({});
  });

  it("is deterministic for shuffled inputs and does not mutate them", () => {
    const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => Object.freeze(service(id)));
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "c"), edge("c", "b"),
      edge("d", "c"), edge("b", "e")].map((value) => Object.freeze(value));
    const positions = canvasAutoLayout(Object.freeze(nodes), Object.freeze(edges));
    expect(canvasAutoLayout([...nodes].reverse(), [...edges].reverse())).toEqual(positions);
    expect(canvasAutoLayout([...nodes.slice(2), ...nodes.slice(0, 2)],
      [...edges.slice(3), ...edges.slice(0, 3)])).toEqual(positions);
  });

  it("lays out 50 services in under 50ms without overlaps", () => {
    const nodes = Array.from({ length: 50 }, (_, index) => service(`service-${index}`, {
      kind: index >= 45 ? "database" : "application",
    }));
    const edges = nodes.slice(1, 40).map((node, index) => edge(nodes[Math.floor(index / 2)].id, node.id));
    const start = performance.now();
    const positions = canvasAutoLayout(nodes, edges);
    expect(performance.now() - start).toBeLessThan(50);
    expectNoOverlaps(nodes, positions);
  });
});
