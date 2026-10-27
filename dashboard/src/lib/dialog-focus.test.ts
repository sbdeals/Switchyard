import { describe, expect, it } from "vitest";
import { focusBoundaryIndex, removeDialog, type DialogEntry } from "./dialog-focus";

describe("dialog tab boundaries", () => {
  it("traps both directions from the initially focused container or an outside element", () => {
    expect(focusBoundaryIndex(-1, 3, false)).toBe(0);
    expect(focusBoundaryIndex(-1, 3, true)).toBe(2);
  });

  it("wraps at the ends and leaves interior tab stops to the browser", () => {
    expect(focusBoundaryIndex(0, 3, true)).toBe(2);
    expect(focusBoundaryIndex(2, 3, false)).toBe(0);
    expect(focusBoundaryIndex(1, 3, false)).toBeNull();
    expect(focusBoundaryIndex(1, 3, true)).toBeNull();
  });

  it("handles empty and single-control dialogs", () => {
    expect(focusBoundaryIndex(-1, 0, true)).toBeNull();
    expect(focusBoundaryIndex(0, 1, true)).toBe(0);
    expect(focusBoundaryIndex(0, 1, false)).toBe(0);
  });
});

describe("dialog return focus", () => {
  const contains = (panel: string, target: string) => target.startsWith(panel);

  it("returns to the opener when the topmost dialog closes", () => {
    const parent = { panel: "menu", opener: "trigger" };
    const child = { panel: "dialog", opener: "menu-button" };
    const stack = [parent, child];
    expect(removeDialog(stack, child, contains)).toBe("menu-button");
    expect(stack).toEqual([parent]);
    expect(removeDialog(stack, parent, contains)).toBe("trigger");
  });

  it("keeps focus in the new dialog while its outgoing opener panel animates away", () => {
    const parent = { panel: "menu", opener: "trigger" };
    const child = { panel: "dialog", opener: "menu-button" };
    const stack = [parent, child];
    expect(removeDialog(stack, parent, contains)).toBeNull();
    expect(child.opener).toBe("trigger");
    expect(removeDialog(stack, child, contains)).toBe("trigger");
  });

  it("ignores stale cleanups and allows a dialog without an opener", () => {
    const entry: DialogEntry<string> = { panel: "dialog", opener: null };
    const stack = [entry];
    expect(removeDialog(stack, { panel: "stale", opener: "trigger" }, contains)).toBeNull();
    expect(stack).toEqual([entry]);
    expect(removeDialog(stack, entry, contains)).toBeNull();
    expect(stack).toEqual([]);
  });
});
