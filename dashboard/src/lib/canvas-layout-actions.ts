import { CANVAS_POSITIONS_KEY, parsePositions, type Positions } from "./canvas-layout";
const ANIMATION_MS = 350;
const UNDO_MS = 10_000;

export function loadPositions(): Positions {
  if (typeof window === "undefined") return {};
  try {
    return parsePositions(localStorage.getItem(CANVAS_POSITIONS_KEY));
  } catch {
    return {};
  }
}

export function savePositions(positions: Positions) {
  try {
    localStorage.setItem(CANVAS_POSITIONS_KEY, JSON.stringify(positions));
  } catch {
    /* ignore */
  }
}

export function positionsForCanvasSync(
  current: { id: string; position: { x: number; y: number } }[],
  preserveCurrent: boolean
): Positions {
  const saved = loadPositions();
  // Restore after hydration; later refreshes must keep in-session node moves.
  return preserveCurrent
    ? { ...saved, ...Object.fromEntries(current.map((node) => [node.id, node.position])) }
    : saved;
}

function copyPositions(positions: Positions): Positions {
  return Object.fromEntries(
    Object.entries(positions).map(([id, position]) => [id, { ...position }])
  );
}

export function createCanvasLayoutActions({
  getPositions,
  setPositions,
  onUndoAvailable,
  onAnimating,
  onSettled,
}: {
  getPositions: () => Positions;
  setPositions: (positions: Positions) => void;
  onUndoAvailable: (available: boolean) => void;
  onAnimating: (active: boolean) => void;
  onSettled: () => void;
}) {
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: { positions: Positions; saved: string | null | undefined } | undefined;
  let disposed = false;

  function animate(target: Positions) {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    const from = copyPositions(getPositions());
    onAnimating(true);

    function finish() {
      frame = undefined;
      setPositions(target);
      onAnimating(false);
      onSettled();
    }

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }

    const start = performance.now();
    function step(time: number) {
      const progress = Math.min(1, Math.max(0, (time - start) / ANIMATION_MS));
      if (progress === 1) {
        finish();
        return;
      }
      const eased = progress * progress * (3 - 2 * progress);
      setPositions(Object.fromEntries(Object.entries(target).map(([id, to]) => {
        const origin = from[id] ?? to;
        return [id, {
          x: origin.x + (to.x - origin.x) * eased,
          y: origin.y + (to.y - origin.y) * eased,
        }];
      })));
      frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
  }

  return {
    tidy(target: Positions) {
      if (disposed) return;
      let saved: string | null | undefined;
      try {
        saved = localStorage.getItem(CANVAS_POSITIONS_KEY);
      } catch {
        // If storage cannot be read, Undo must not overwrite an unknown value.
      }
      previous = { positions: copyPositions(getPositions()), saved };
      clearTimeout(timer);
      onUndoAvailable(true);
      timer = setTimeout(() => {
        previous = undefined;
        onUndoAvailable(false);
      }, UNDO_MS);
      const positions = copyPositions(target);
      savePositions(positions);
      animate(positions);
    },
    undo() {
      if (disposed || !previous) return;
      const snapshot = previous;
      previous = undefined;
      clearTimeout(timer);
      onUndoAvailable(false);
      try {
        if (snapshot.saved === null) localStorage.removeItem(CANVAS_POSITIONS_KEY);
        else if (snapshot.saved !== undefined) {
          localStorage.setItem(CANVAS_POSITIONS_KEY, snapshot.saved);
        }
      } catch {
        /* ignore */
      }
      animate(snapshot.positions);
    },
    dispose() {
      disposed = true;
      previous = undefined;
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    },
  };
}
