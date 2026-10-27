import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirtyGuardProvider, useGuardedNavigation } from "../components/DirtyGuard";

const mocks = vi.hoisted(() => ({ useState: vi.fn(), useRef: vi.fn(), useEffect: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: mocks.useState,
  useRef: mocks.useRef,
  useEffect: mocks.useEffect,
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));

type Dialog = ReactElement<{ onKeep: () => void; onDiscard: () => void }>;
class Field {
  isConnected = true;
  matches = () => true;
  focus = vi.fn();
}

// Run the real provider and its callbacks with persistent hooks. The returned
// dialog props let these tests exercise resolution without a DOM dependency.
function mount() {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let lastDirty: unknown;
  let cleanup: void | (() => void);
  let effect: (() => void) | undefined;
  const unload = new Set<(event: { preventDefault: () => void; returnValue?: string }) => void>();
  const frames: (() => void)[] = [];
  vi.stubGlobal("window", {
    addEventListener: (_type: string, listener: (event: { preventDefault: () => void }) => void) => unload.add(listener),
    removeEventListener: (_type: string, listener: (event: { preventDefault: () => void }) => void) => unload.delete(listener),
  });
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("HTMLElement", Field);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  mocks.useState.mockImplementation((initial: unknown) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (next: unknown) => {
      states[index] = typeof next === "function" ? next(states[index]) : next;
    }];
  });
  mocks.useRef.mockImplementation((initial: unknown) => {
    const index = refIndex++;
    return refs[index] ??= { current: initial };
  });
  mocks.useEffect.mockImplementation((run: () => void | (() => void), [dirty]: unknown[]) => {
    if (Object.is(lastDirty, dirty)) return;
    lastDirty = dirty;
    effect = () => { cleanup?.(); cleanup = run(); };
  });

  function render() {
    stateIndex = refIndex = 0;
    const tree = DirtyGuardProvider({ children: null });
    effect?.();
    effect = undefined;
    return {
      guard: tree.props.value as ReturnType<typeof useGuardedNavigation>,
      dialog: tree.props.children.props.children[1] as Dialog | null,
      focus: (field: Field) => tree.props.children.props.onFocusCapture({ target: field }),
    };
  }
  return { render, unload, frames, unmount: () => cleanup?.() };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("dirty guard provider", () => {
  it("accepts only active registrations and ignores an exiting scope", () => {
    const ui = mount();
    const { guard } = ui.render();
    guard.register("form", "Variables", true, "first");
    expect(guard.getState("first").labels).toEqual([]);
    guard.activateScope("first");
    guard.register("form", "Variables", true, "first");
    guard.register("other", "Compose", true, "other");
    expect(ui.render().guard.activeScope).toBe("first");
    expect(guard.getState("first").labels).toEqual(["Variables"]);
    expect(guard.getState("other").labels).toEqual([]);
    expect(ui.unload.size).toBe(1);
    guard.activateScope(null);
    guard.register("form", "Variables", true, "first");
    ui.render();
    expect(guard.getState("first").labels).toEqual([]);
    expect(ui.unload.size).toBe(0);
  });

  it("keeps unload protection and restores field focus after Keep editing", () => {
    const ui = mount();
    const { guard, focus } = ui.render();
    guard.activateScope("first");
    guard.register("form", "Variables", true, "first");
    const field = new Field();
    focus(field);
    const action = vi.fn();
    const duplicate = vi.fn();
    guard.navigate(action);
    guard.navigate(duplicate);
    const dialog = ui.render().dialog as Dialog;
    const event = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };
    ui.unload.forEach((listener) => listener(event));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
    dialog.props.onKeep();
    expect(ui.render().dialog).toBeNull();
    expect(guard.getState("first")).toEqual({ labels: ["Variables"], pending: false });
    expect(ui.unload.size).toBe(1);
    ui.frames.forEach((callback) => callback());
    expect(field.focus).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    ui.unmount();
    expect(ui.unload.size).toBe(0);
  });

  it("discards once, clears dirty state, and advances the editor session", () => {
    const ui = mount();
    const { guard } = ui.render();
    guard.activateScope("first");
    guard.register("form", "Variables", true, "first");
    const action = vi.fn();
    guard.navigate(action);
    const dialog = ui.render().dialog as Dialog;
    dialog.props.onDiscard();
    dialog.props.onDiscard();
    expect(ui.render().guard.session).toBe(1);
    expect(guard.getState("first")).toEqual({ labels: [], pending: false });
    expect(ui.unload.size).toBe(0);
    expect(action).toHaveBeenCalledOnce();
  });

  it("cancels a pending action when its scope becomes invalid", () => {
    const ui = mount();
    const { guard } = ui.render();
    guard.activateScope("first");
    guard.register("form", "Variables", true, "first");
    const action = vi.fn();
    guard.navigate(action);
    const staleDialog = ui.render().dialog as Dialog;
    guard.activateScope(null);
    staleDialog.props.onDiscard();
    const next = ui.render();
    expect(next.dialog).toBeNull();
    expect(next.guard.session).toBe(0);
    expect(guard.getState("first")).toEqual({ labels: [], pending: false });
    expect(action).not.toHaveBeenCalled();
    expect(ui.unload.size).toBe(0);
  });
});
