export type Point = { x: number; y: number };
export type Positions = Record<string, Point>;

// v2 only persists positions explicitly chosen by the user, leaving the default
// grid free to improve for services that have never been placed or dragged.
export const CANVAS_POSITIONS_KEY = "switchyard:positions:v2";

export function isCanvasCreateShortcut(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean },
  canvasFocused: boolean,
): boolean {
  return canvasFocused && event.key.toLowerCase() === "n" &&
    !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat;
}

export function screenToFlowPosition(
  point: Point,
  bounds: { left: number; top: number },
  viewport: Point & { zoom: number },
): Point {
  return {
    x: (point.x - bounds.left - viewport.x) / viewport.zoom,
    y: (point.y - bounds.top - viewport.y) / viewport.zoom,
  };
}

export function canvasCenter(bounds: {
  left: number;
  top: number;
  width: number;
  height: number;
}): Point {
  return {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  };
}

export function anchoredMenuPosition(
  point: Point,
  viewport: { width: number; height: number },
  menu: { width: number; height: number },
  margin = 8,
): Point {
  return {
    x: Math.max(margin, Math.min(point.x, viewport.width - menu.width - margin)),
    y: Math.max(margin, Math.min(point.y, viewport.height - menu.height - margin)),
  };
}

export function placeService(positions: Positions, id: string, point: Point): Positions {
  return { ...positions, [id]: { x: point.x, y: point.y } };
}

export function parsePositions(raw: string | null): Positions {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, point]) => {
        if (
          !point || typeof point !== "object" || Array.isArray(point) ||
          typeof point.x !== "number" || !Number.isFinite(point.x) ||
          typeof point.y !== "number" || !Number.isFinite(point.y)
        ) return [];
        return [[id, { x: point.x, y: point.y }]];
      }),
    );
  } catch {
    return {};
  }
}
