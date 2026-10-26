import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_POSITIONS_KEY,
  createCanvasLayoutActions,
  loadPositions,
  positionsForCanvasSync,
} from "./canvas-layout-actions";
import type { Positions } from "./canvas-auto-layout";

describe("canvas layout actions", () => {
  let stored: Map<string, string>;
  let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
  let frames: Map<number, FrameRequestCallback>;
  let now: number;
  let positions: Positions;
  let setPositions: ReturnType<typeof vi.fn>;
  let onUndoAvailable: ReturnType<typeof vi.fn>;
  let onAnimating: ReturnType<typeof vi.fn>;
  let onSettled: ReturnType<typeof vi.fn>;
  let actions: ReturnType<typeof createCanvasLayoutActions>;

  const target = { a: { x: 400, y: 200 }, b: { x: 800, y: 100 } };
  const initial = { a: { x: 0, y: 0 }, b: { x: 100, y: 300 } };

  beforeEach(() => {
    vi.useFakeTimers();
    stored = new Map();
    storage = {
      getItem: vi.fn((key: string) => stored.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { stored.set(key, value); }),
      removeItem: vi.fn((key: string) => { stored.delete(key); }),
    };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { matchMedia: vi.fn(() => ({ matches: false })) });
    frames = new Map();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    positions = structuredClone(initial);
    setPositions = vi.fn((next: Positions) => { positions = next; });
    onUndoAvailable = vi.fn();
    onAnimating = vi.fn();
    onSettled = vi.fn();
    actions = createCanvasLayoutActions({
      getPositions: () => positions,
      setPositions,
      onUndoAvailable,
      onAnimating,
      onSettled,
    });
  });

  afterEach(() => {
    actions.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function advanceFrame(time: number) {
    now = time;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  }

  it("leaves displayed and saved positions untouched until Tidy", () => {
    stored.set(CANVAS_POSITIONS_KEY, '{"a":{"x":7,"y":8}}');
    expect(loadPositions()).toEqual({ a: { x: 7, y: 8 } });
    vi.advanceTimersByTime(20_000);
    expect(positions).toEqual(initial);
    expect(setPositions).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("restores saved positions after hydration instead of keeping server defaults", () => {
    const saved = '{"a":{"x":700,"y":800}}';
    stored.set(CANVAS_POSITIONS_KEY, saved);
    const serverNodes = Object.entries(initial).map(([id, position]) => ({ id, position }));
    const restored = positionsForCanvasSync(serverNodes, false);
    expect(restored).toEqual({ a: { x: 700, y: 800 } });
    expect(initial.a).toEqual({ x: 0, y: 0 });
    expect(stored.get(CANVAS_POSITIONS_KEY)).toBe(saved);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("keeps live positions on later refreshes while restoring newly appearing saved nodes", () => {
    const saved = { a: { x: 700, y: 800 }, c: { x: 900, y: 300 } };
    stored.set(CANVAS_POSITIONS_KEY, JSON.stringify(saved));
    const moved = { a: { x: 40, y: 50 }, b: initial.b };
    const current = Object.entries(moved).map(([id, position]) => ({ id, position }));
    expect(positionsForCanvasSync(current, true)).toEqual({ ...moved, c: saved.c });
    expect(stored.get(CANVAS_POSITIONS_KEY)).toBe(JSON.stringify(saved));
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("persists the destination immediately and animates without intermediate storage writes", () => {
    actions.tidy(target);
    expect(stored.get(CANVAS_POSITIONS_KEY)).toBe(JSON.stringify(target));
    expect(positions).toEqual(initial);
    expect(onAnimating).toHaveBeenLastCalledWith(true);
    expect(onUndoAvailable).toHaveBeenLastCalledWith(true);

    advanceFrame(175);
    expect(positions).toEqual({ a: { x: 200, y: 100 }, b: { x: 450, y: 200 } });
    advanceFrame(350);
    expect(positions).toEqual(target);
    expect(onAnimating).toHaveBeenLastCalledWith(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("Undo restores displayed positions and the exact sparse saved value", () => {
    const saved = '{ "a": { "x": 7, "y": 8 } }';
    stored.set(CANVAS_POSITIONS_KEY, saved);
    actions.tidy(target);
    advanceFrame(350);
    actions.undo();
    expect(stored.get(CANVAS_POSITIONS_KEY)).toBe(saved);
    expect(onUndoAvailable).toHaveBeenLastCalledWith(false);
    advanceFrame(700);
    expect(positions).toEqual(initial);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    actions.undo();
    expect(frames.size).toBe(0);
  });

  it("Undo removes the saved key when the original layout was unsaved", () => {
    actions.tidy(target);
    advanceFrame(350);
    actions.undo();
    expect(stored.has(CANVAS_POSITIONS_KEY)).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith(CANVAS_POSITIONS_KEY);
    advanceFrame(700);
    expect(positions).toEqual(initial);
  });

  it("expires Undo after ten seconds", () => {
    actions.tidy(target);
    advanceFrame(350);
    vi.advanceTimersByTime(9_999);
    expect(onUndoAvailable).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(1);
    expect(onUndoAvailable).toHaveBeenLastCalledWith(false);
    actions.undo();
    expect(positions).toEqual(target);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("a second Tidy resets the expiry and Undo restores the immediately previous layout", () => {
    actions.tidy(target);
    advanceFrame(350);
    vi.advanceTimersByTime(6_000);
    const second = { a: { x: 900, y: 0 }, b: { x: 900, y: 400 } };
    actions.tidy(second);
    advanceFrame(700);
    vi.advanceTimersByTime(4_001);
    expect(onUndoAvailable).toHaveBeenLastCalledWith(true);
    actions.undo();
    expect(stored.get(CANVAS_POSITIONS_KEY)).toBe(JSON.stringify(target));
    advanceFrame(1_050);
    expect(positions).toEqual(target);
    vi.advanceTimersByTime(10_000);
    expect(onUndoAvailable.mock.calls).toEqual([[true], [true], [false]]);
  });

  it("replaces an in-flight animation and snapshots positions without retaining mutable inputs", () => {
    const input = structuredClone(target);
    actions.tidy(input);
    input.a.x = -999;
    advanceFrame(175);
    const halfway = structuredClone(positions);
    actions.tidy(initial);
    expect(frames.size).toBe(1);
    advanceFrame(525);
    actions.undo();
    advanceFrame(875);
    expect(positions).toEqual(halfway);
    expect(stored.get(CANVAS_POSITIONS_KEY)).toBe(JSON.stringify(target));
  });

  it("disposes timers and animation frames without changing storage or issuing later callbacks", () => {
    actions.tidy(target);
    actions.dispose();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    advanceFrame(350);
    vi.advanceTimersByTime(10_000);
    actions.undo();
    actions.tidy(initial);
    expect(setPositions).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    expect(onUndoAvailable.mock.calls).toEqual([[true]]);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("respects reduced motion for Tidy and Undo", () => {
    vi.stubGlobal("window", { matchMedia: vi.fn(() => ({ matches: true })) });
    actions.tidy(target);
    expect(positions).toEqual(target);
    expect(frames.size).toBe(0);
    actions.undo();
    expect(positions).toEqual(initial);
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onAnimating).toHaveBeenLastCalledWith(false);
  });

  it("continues to animate and Undo when storage is unavailable", () => {
    storage.getItem.mockImplementation(() => { throw new Error("blocked"); });
    storage.setItem.mockImplementation(() => { throw new Error("blocked"); });
    expect(loadPositions()).toEqual({});
    expect(() => actions.tidy(target)).not.toThrow();
    advanceFrame(350);
    expect(positions).toEqual(target);
    expect(() => actions.undo()).not.toThrow();
    advanceFrame(700);
    expect(positions).toEqual(initial);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("loads missing and malformed saved positions as an empty map", () => {
    expect(loadPositions()).toEqual({});
    stored.set(CANVAS_POSITIONS_KEY, "broken json");
    expect(loadPositions()).toEqual({});
    vi.stubGlobal("window", undefined);
    expect(loadPositions()).toEqual({});
  });
});
