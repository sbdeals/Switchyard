import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import {
  anchoredMenuPosition,
  canvasCenter,
  CANVAS_POSITIONS_KEY,
  isCanvasCreateShortcut,
  mergeNodePositions,
  parsePositions,
  placeService,
  screenToFlowPosition,
  shouldRefitCanvas,
} from "./canvas-layout";

describe("isCanvasCreateShortcut", () => {
  const event = { key: "n", ctrlKey: false, metaKey: false, altKey: false, repeat: false };

  it.each(["n", "N"])("opens for %s when the canvas itself is focused", (key) => {
    expect(isCanvasCreateShortcut({ ...event, key }, true)).toBe(true);
  });

  it("ignores unrelated keys", () => {
    expect(isCanvasCreateShortcut({ ...event, key: "Enter" }, true)).toBe(false);
  });

  it.each(["ctrlKey", "metaKey", "altKey", "repeat"] as const)(
    "ignores the shortcut with %s",
    (flag) => expect(isCanvasCreateShortcut({ ...event, [flag]: true }, true)).toBe(false),
  );

  it("ignores events from descendants such as inputs, nodes and controls", () => {
    expect(isCanvasCreateShortcut(event, false)).toBe(false);
  });
});

function node(id: string, x = 0, y = 0): Node {
  return { id, position: { x, y }, data: {} };
}

describe("hydrated canvas positions", () => {
  it("restores saved drags over the initial default nodes after hydration", () => {
    const defaults = [node("app"), node("db", 300)];
    const initial = mergeNodePositions(defaults, {});
    const saved = parsePositions('{"app":{"x":720,"y":400}}');
    expect(mergeNodePositions(defaults, saved, initial).map((n) => n.position))
      .toEqual([{ x: 720, y: 400 }, { x: 300, y: 0 }]);
    expect(defaults[0].position).toEqual({ x: 0, y: 0 });
  });

  it("lets an ongoing drag beat saved and created positions during a refresh", () => {
    const dragging = { ...node("app", 900, 700), dragging: true, selected: true, measured: { width: 250, height: 100 } };
    const saved = placeService({}, "app", { x: 300, y: 200 });
    const result = mergeNodePositions([node("app")], saved, [dragging]);
    expect(result[0]).toMatchObject(dragging);
    expect(mergeNodePositions([node("app")], saved, [{ ...dragging, dragging: false }])[0].position)
      .toEqual(saved.app);
  });

  it("reserves created positions before placing new services and hydrated defaults", () => {
    const saved = placeService({}, "created", { x: 0, y: 0 });
    const defaults = [node("new"), node("existing"), node("created")];
    const result = mergeNodePositions(defaults, saved, [node("existing")]);
    expect(result.map((n) => n.position)).toEqual([
      { x: 0, y: 208 }, { x: 0, y: 104 }, { x: 0, y: 0 },
    ]);
    // Collision avoidance must not freeze automatic positions into storage.
    expect(saved).toEqual({ created: { x: 0, y: 0 } });
  });

  it("uses measured card sizes for collision avoidance and ignores deleted services", () => {
    const defaults = [{ ...node("saved"), measured: { width: 240, height: 200 } }, node("new")];
    const saved = { saved: { x: 0, y: 0 }, deleted: { x: 0, y: 312 } };
    expect(mergeNodePositions(defaults, saved)[1].position).toEqual({ x: 0, y: 312 });
  });

  it("keeps existing automatic positions when a new service sorts before them", () => {
    const result = mergeNodePositions([node("new"), node("existing", 0, 104)], {}, [node("existing")]);
    expect(result.map((n) => n.position)).toEqual([{ x: 0, y: 104 }, { x: 0, y: 0 }]);
  });
});

describe("canvas resize fitting", () => {
  const resize = {
    previous: { width: 1000, height: 800 },
    next: { width: 500, height: 400 },
    nodes: [node("app", 800, 600)],
    viewport: { x: 0, y: 0, zoom: 1 },
    interacting: false,
  };

  it("recovers an empty viewport after a significant resize", () => {
    expect(shouldRefitCanvas(resize)).toBe(true);
  });

  it("preserves navigation while a card is visible, even if only partially", () => {
    expect(shouldRefitCanvas({ ...resize, nodes: [node("app", 490, 390)] })).toBe(false);
    expect(shouldRefitCanvas({ ...resize, viewport: { x: -400, y: -400, zoom: 1 } })).toBe(false);
    expect(shouldRefitCanvas({ ...resize, viewport: { x: 0, y: 0, zoom: 0.5 } })).toBe(false);
  });

  it("does not fit during gestures, small changes, initialization or an empty graph", () => {
    expect(shouldRefitCanvas({ ...resize, interacting: true })).toBe(false);
    expect(shouldRefitCanvas({ ...resize, next: { width: 950, height: 750 } })).toBe(false);
    expect(shouldRefitCanvas({ ...resize, previous: { width: 0, height: 0 } })).toBe(false);
    expect(shouldRefitCanvas({ ...resize, next: { width: 0, height: 0 } })).toBe(false);
    expect(shouldRefitCanvas({ ...resize, nodes: [] })).toBe(false);
    expect(shouldRefitCanvas({ ...resize, nodes: [{ ...node("hidden"), hidden: true }] })).toBe(false);
  });

  it("fits when the viewport only intersects empty space between groups", () => {
    expect(shouldRefitCanvas({ ...resize, nodes: [node("left", -500), node("right", 800)] })).toBe(true);
  });
});

describe("screenToFlowPosition", () => {
  it("subtracts the canvas origin at the default viewport", () => {
    expect(screenToFlowPosition(
      { x: 420, y: 260 },
      { left: 120, top: 60 },
      { x: 0, y: 0, zoom: 1 },
    )).toEqual({ x: 300, y: 200 });
  });

  it("undoes canvas pan and zoom without snapping the clicked point", () => {
    expect(screenToFlowPosition(
      { x: 421, y: 261 },
      { left: 120, top: 60 },
      { x: -100, y: 50, zoom: 2 },
    )).toEqual({ x: 200.5, y: 75.5 });
  });

  it("supports a zoomed-out viewport and negative flow coordinates", () => {
    expect(screenToFlowPosition(
      { x: 140, y: 100 },
      { left: 120, top: 60 },
      { x: 100, y: 80, zoom: 0.5 },
    )).toEqual({ x: -160, y: -80 });
  });
});

describe("canvasCenter", () => {
  it("finds the visible canvas center in screen coordinates", () => {
    const bounds = { left: 240, top: 80, width: 800, height: 600 };
    const center = canvasCenter(bounds);
    expect(center).toEqual({ x: 640, y: 380 });
    expect(screenToFlowPosition(center, bounds, { x: 100, y: -100, zoom: 2 }))
      .toEqual({ x: 150, y: 200 });
  });
});

describe("anchoredMenuPosition", () => {
  const viewport = { width: 1000, height: 800 };
  const menu = { width: 300, height: 400 };

  it("keeps a menu at the clicked point when it fits", () => {
    expect(anchoredMenuPosition({ x: 200, y: 150 }, viewport, menu))
      .toEqual({ x: 200, y: 150 });
  });

  it("moves the menu inside the viewport without changing the creation point", () => {
    const point = { x: 980, y: 790 };
    expect(anchoredMenuPosition(point, viewport, menu)).toEqual({ x: 692, y: 392 });
    expect(point).toEqual({ x: 980, y: 790 });
  });

  it("respects the top and left margins, including small viewports", () => {
    expect(anchoredMenuPosition({ x: -5, y: 0 }, viewport, menu, 12))
      .toEqual({ x: 12, y: 12 });
    expect(anchoredMenuPosition({ x: 100, y: 100 }, { width: 200, height: 200 }, menu))
      .toEqual({ x: 8, y: 8 });
  });
});

describe("saved canvas positions", () => {
  it("uses the existing dragged-position storage key", () => {
    expect(CANVAS_POSITIONS_KEY).toBe("switchyard:positions:v2");
  });

  it("adds a created service without mutating its point or existing positions", () => {
    const existing = { old: { x: 10, y: 20 } };
    const point = { x: 123.5, y: -50 };
    const result = placeService(existing, "new", point);
    expect(result).toEqual({ old: { x: 10, y: 20 }, new: point });
    expect(existing).toEqual({ old: { x: 10, y: 20 } });
    expect(result).not.toBe(existing);
    point.x = 0;
    expect(result.new).toEqual({ x: 123.5, y: -50 });
  });

  it("updates a position and preserves two distinct creation points across serialization", () => {
    const first = placeService({}, "first", { x: 150, y: 300 });
    const second = placeService(first, "second", { x: 600, y: -90 });
    expect(parsePositions(JSON.stringify(second))).toEqual(second);
    expect(placeService(second, "first", { x: 200, y: 400 })).toEqual({
      first: { x: 200, y: 400 }, second: { x: 600, y: -90 },
    });
    expect(second.first).toEqual({ x: 150, y: 300 });
  });

  it.each([null, "", "{", "null", "false", "12", '"text"', "[]"])(
    "treats invalid or missing storage %s as an empty layout",
    (raw) => expect(parsePositions(raw)).toEqual({}),
  );

  it("keeps valid points and discards malformed or non-finite entries", () => {
    expect(parsePositions(`{
      "valid": {"x": -10.5, "y": 0, "extra": true},
      "missing": {"x": 10},
      "string": {"x": "10", "y": 20},
      "infinite": {"x": 1e400, "y": 20},
      "null": null,
      "array": [10, 20]
    }`)).toEqual({ valid: { x: -10.5, y: 0 } });
  });

  it("does not change object prototypes for a stored service named __proto__", () => {
    const positions = parsePositions('{"__proto__":{"x":1,"y":2}}');
    expect(Object.getPrototypeOf(positions)).toBe(Object.prototype);
    expect(Object.hasOwn(positions, "__proto__")).toBe(true);
    expect(positions.__proto__).toEqual({ x: 1, y: 2 });
  });
});
