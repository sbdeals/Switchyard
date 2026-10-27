import { describe, expect, it } from "vitest";
import {
  SHORTCUT_GROUPS,
  SHORTCUTS,
  formatShortcutKeys,
  isTypingTarget,
  shouldOpenShortcuts,
  type Shortcut,
} from "./shortcuts";

// The suite runs in Node; these fixtures model only the DOM properties the
// target guard reads, including inherited contenteditable boundaries.
function element(name: string, editable: string | null = null, parent: EventTarget | null = null): EventTarget {
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    parentElement: parent,
    getAttribute: (attribute: string) => attribute === "contenteditable" ? editable : null,
  } as unknown as EventTarget;
}

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "?",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: true,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    target: element("button"),
    ...overrides,
  } as KeyboardEvent;
}

describe("shortcut registry", () => {
  it("groups implemented shortcuts and provides a label and keys for every entry", () => {
    expect(SHORTCUT_GROUPS).toEqual(["Global", "Canvas", "Service drawer"]);
    for (const group of SHORTCUT_GROUPS) {
      expect(Object.values(SHORTCUTS).some((shortcut) => shortcut.group === group)).toBe(true);
    }
    for (const shortcut of Object.values(SHORTCUTS)) {
      expect(SHORTCUT_GROUPS).toContain(shortcut.group);
      expect(shortcut.label.trim()).not.toBe("");
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(new Set(shortcut.keys).size).toBe(shortcut.keys.length);
      expect(shortcut.keys.every((key) => key.length > 0)).toBe(true);
    }
  });

  it("keeps handler bindings and React Flow defaults accurate", () => {
    expect(SHORTCUTS.help.keys).toEqual(["?"]);
    expect(SHORTCUTS.close.keys).toEqual(["Escape"]);
    expect(SHORTCUTS.openService.keys).toEqual(["Enter", " "]);
    expect(SHORTCUTS.runQuery.keys).toEqual(["Enter"]);
    expect(SHORTCUTS.runQuery.modifier).toBe("primary");
    expect(SHORTCUTS.removeFromCanvas.keys).toEqual(["Backspace"]);
    expect(SHORTCUTS.removeFromCanvas.context).toContain("does not delete services");
    expect(SHORTCUTS.moveNodes.keys).toEqual(["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]);
    expect(SHORTCUTS.moveNodesFaster.modifier).toBe("shift");
    expect(Object.values(SHORTCUTS).flatMap((shortcut) => shortcut.keys)).not.toContain("n");
    expect(Object.values(SHORTCUTS).flatMap((shortcut) => shortcut.keys)).not.toContain("k");
  });

  it.each(["MacIntel", "Macintosh", "MacARM"])("uses Command on %s", (platform) => {
    expect(formatShortcutKeys(SHORTCUTS.runQuery, platform)).toEqual(["⌘ + Enter"]);
    expect(formatShortcutKeys(SHORTCUTS.multiSelect, platform)).toEqual(["⌘ + Click"]);
  });

  it.each(["Win32", "Linux x86_64", ""])("uses Control on %s", (platform) => {
    expect(formatShortcutKeys(SHORTCUTS.runQuery, platform)).toEqual(["Ctrl + Enter"]);
  });

  it("formats alternatives, named keys, Shift chords, and mouse gestures", () => {
    expect(formatShortcutKeys(SHORTCUTS.openService, "Linux")).toEqual(["Enter", "Space"]);
    expect(formatShortcutKeys(SHORTCUTS.close, "MacIntel")).toEqual(["Esc"]);
    expect(formatShortcutKeys(SHORTCUTS.moveNodesFaster, "MacIntel"))
      .toEqual(["Shift + ←", "Shift + ↑", "Shift + →", "Shift + ↓"]);
    expect(formatShortcutKeys(SHORTCUTS.resizeDrawerFaster, "Linux"))
      .toEqual(["Page Up", "Page Down"]);
    expect(formatShortcutKeys(SHORTCUTS.pan, "Linux"))
      .toEqual(["Space + Drag", "Space + Scroll"]);
    const unknown: Shortcut = { group: "Global", label: "Test", keys: ["F2"] };
    expect(formatShortcutKeys(unknown, "Linux")).toEqual(["F2"]);
  });
});

describe("isTypingTarget", () => {
  it.each(["input", "textarea", "select"])("recognizes %s fields", (name) => {
    expect(isTypingTarget(element(name))).toBe(true);
    expect(isTypingTarget(element(name, "false"))).toBe(true);
  });

  it.each(["", "true", "TRUE", "plaintext-only"])("recognizes contenteditable=%j and descendants", (value) => {
    const editor = element("div", value);
    expect(isTypingTarget(editor)).toBe(true);
    expect(isTypingTarget(element("span", null, element("b", null, editor)))).toBe(true);
    expect(isTypingTarget(element("span", "invalid", editor))).toBe(true);
  });

  it("respects explicit false islands and nested editable hosts", () => {
    const editor = element("div", "true");
    const island = element("span", "false", editor);
    expect(isTypingTarget(island)).toBe(false);
    expect(isTypingTarget(element("b", null, island))).toBe(false);
    expect(isTypingTarget(element("span", "true", island))).toBe(true);
    expect(isTypingTarget(element("input", null, island))).toBe(true);
  });

  it("handles text nodes inside editors", () => {
    const text = { nodeType: 3, parentElement: element("div", "true") } as unknown as EventTarget;
    expect(isTypingTarget(text)).toBe(true);
  });

  it("ignores ordinary controls, invalid editable values, and non-element targets", () => {
    expect(isTypingTarget(element("button"))).toBe(false);
    expect(isTypingTarget(element("div", "invalid"))).toBe(false);
    expect(isTypingTarget(element("div", "false"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(new EventTarget())).toBe(false);
  });
});

describe("shouldOpenShortcuts", () => {
  it("opens on a question mark outside a field, including Shift+?", () => {
    expect(shouldOpenShortcuts(keyEvent())).toBe(true);
    expect(shouldOpenShortcuts(keyEvent({ shiftKey: false }))).toBe(true);
    expect(shouldOpenShortcuts(keyEvent({ target: null }))).toBe(true);
  });

  it.each(["/", "n", "k", "Escape", "Enter"])("ignores %j", (key) => {
    expect(shouldOpenShortcuts(keyEvent({ key }))).toBe(false);
  });

  it.each(["ctrlKey", "metaKey", "altKey", "defaultPrevented", "repeat", "isComposing"] as const)
    ("ignores events with %s", (flag) => {
      expect(shouldOpenShortcuts(keyEvent({ [flag]: true }))).toBe(false);
    });

  it("ignores question marks while typing, but permits non-editable islands", () => {
    const editor = element("div", "true");
    for (const target of [element("input"), element("textarea"), editor, element("span", null, editor)]) {
      expect(shouldOpenShortcuts(keyEvent({ target }))).toBe(false);
    }
    expect(shouldOpenShortcuts(keyEvent({ target: element("span", "false", editor) }))).toBe(true);
  });
});
