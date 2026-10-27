import { describe, expect, it } from "vitest";
import {
  applySelectionChanges,
  emptySelection,
  hasSelectionModifier,
  reconcileSelection,
  replaceSelection,
  toggleSelection,
} from "./bulk-selection";

const ids = ["a", "b", "c", "d", "e"];

describe("bulk selection", () => {
  it("applies canvas selection deltas without losing unrelated selections", () => {
    expect(applySelectionChanges(["a", "b", "b"], [
      { id: "b", selected: false },
      { id: "c", selected: true },
      { id: "c", selected: true },
      { id: "missing", selected: false },
    ])).toEqual(["a", "c"]);
  });

  it("applies repeated canvas deltas in order", () => {
    expect(applySelectionChanges(["a"], [
      { id: "a", selected: false },
      { id: "a", selected: true },
    ])).toEqual(["a"]);
  });

  it("recognizes each supported mouse or keyboard selection modifier", () => {
    expect(hasSelectionModifier({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe(false);
    for (const modifier of ["shiftKey", "ctrlKey", "metaKey"] as const) {
      expect(hasSelectionModifier({ shiftKey: false, ctrlKey: false, metaKey: false, [modifier]: true }))
        .toBe(true);
    }
  });

  it("toggles one service and keeps selection in display order", () => {
    const first = toggleSelection(emptySelection, ids, "c", false);
    const second = toggleSelection(first, ids, "a", false);
    expect(first).toEqual({ ids: ["c"], anchor: "c" });
    expect(second).toEqual({ ids: ["a", "c"], anchor: "a" });
    expect(toggleSelection(second, ids, "c", false)).toEqual({ ids: ["a"], anchor: "c" });
    expect(emptySelection).toEqual({ ids: [], anchor: null });
  });

  it("shift-selects an inclusive range in either direction and retains the anchor", () => {
    const first = toggleSelection(emptySelection, ids, "c", false);
    const forward = toggleSelection(first, ids, "e", true);
    expect(forward).toEqual({ ids: ["c", "d", "e"], anchor: "c" });
    expect(toggleSelection(forward, ids, "a", true)).toEqual({ ids, anchor: "c" });
  });

  it("shift-deselects the range when its target is already checked", () => {
    const selection = { ids, anchor: "d" };
    expect(toggleSelection(selection, ids, "b", true)).toEqual({ ids: ["a", "e"], anchor: "d" });
    expect(selection).toEqual({ ids, anchor: "d" });
  });

  it("preserves selections outside the shift range", () => {
    const first = { ids: ["a", "c"], anchor: "c" };
    expect(toggleSelection(first, ids, "d", true)).toEqual({ ids: ["a", "c", "d"], anchor: "c" });
  });

  it("uses a normal toggle when shift has no available anchor", () => {
    expect(toggleSelection({ ids: ["gone"], anchor: "gone" }, ids, "b", true))
      .toEqual({ ids: ["b"], anchor: "b" });
    expect(toggleSelection(emptySelection, ids, "b", true))
      .toEqual({ ids: ["b"], anchor: "b" });
  });

  it("prunes deleted or filtered services and clears a missing anchor", () => {
    const selection = { ids: ["e", "a", "gone", "a"], anchor: "gone" };
    expect(reconcileSelection(selection, ["a", "b", "a"]))
      .toEqual({ ids: ["a"], anchor: null });
    expect(reconcileSelection(selection, [])).toEqual(emptySelection);
  });

  it("never selects an unavailable target", () => {
    expect(toggleSelection({ ids: ["a", "gone"], anchor: "a" }, ids, "gone", true))
      .toEqual({ ids: ["a"], anchor: "a" });
  });

  it("normalizes canvas selections and preserves a selected anchor", () => {
    expect(replaceSelection({ ids: ["b"], anchor: "b" }, ids, ["e", "b", "b", "gone"]))
      .toEqual({ ids: ["b", "e"], anchor: "b" });
  });

  it("replaces the canvas anchor when needed and clears it on deselect", () => {
    const selection = { ids: ["a"], anchor: "a" };
    expect(replaceSelection(selection, ids, ["d", "b"]))
      .toEqual({ ids: ["b", "d"], anchor: "d" });
    expect(replaceSelection(selection, ids, [])).toEqual(emptySelection);
  });
});
