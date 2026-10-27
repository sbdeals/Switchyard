export const SHORTCUT_GROUPS = ["Global", "Canvas", "Service drawer"] as const;

export type Shortcut = {
  group: (typeof SHORTCUT_GROUPS)[number];
  label: string;
  context?: string;
  keys: readonly string[];
  modifier?: "primary" | "shift";
};

// DOM key values are shared with handlers where practical. Canvas gestures also
// document React Flow's enabled defaults in FlowCanvas (not service actions).
export const SHORTCUTS = {
  help: {
    group: "Global",
    label: "Keyboard shortcuts",
    context: "Outside text fields",
    keys: ["?"],
  },
  close: {
    group: "Global",
    label: "Close dialog, drawer, or menu",
    context: "Closes the topmost open dialog",
    keys: ["Escape"],
  },
  focusNext: {
    group: "Global",
    label: "Focus next control",
    context: "Focus stays inside an open dialog",
    keys: ["Tab"],
  },
  focusPrevious: {
    group: "Global",
    label: "Focus previous control",
    keys: ["Tab"],
    modifier: "shift",
  },
  submitField: {
    group: "Global",
    label: "Submit or save the focused field",
    context: "Quick deploy, project/environment names, and copilot settings",
    keys: ["Enter"],
  },
  sendMessage: {
    group: "Global",
    label: "Send copilot message",
    context: "Copilot message field",
    keys: ["Enter"],
  },
  messageNewline: {
    group: "Global",
    label: "New line in copilot message",
    context: "Copilot message field",
    keys: ["Enter"],
    modifier: "shift",
  },
  openService: {
    group: "Canvas",
    label: "Open service details",
    context: "Service card focused",
    keys: ["Enter", " "],
  },
  selectElement: {
    group: "Canvas",
    label: "Select node or connection",
    context: "Canvas node wrapper or connection focused",
    keys: ["Enter", " "],
  },
  deselectElement: {
    group: "Canvas",
    label: "Deselect node or connection",
    context: "Canvas node wrapper or connection focused",
    keys: ["Escape"],
  },
  moveNodes: {
    group: "Canvas",
    label: "Move selected nodes",
    context: "Selected node or selection focused; moves 5 px",
    keys: ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"],
  },
  moveNodesFaster: {
    group: "Canvas",
    label: "Move selected nodes farther",
    context: "Selected node or selection focused; moves 20 px",
    keys: ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"],
    modifier: "shift",
  },
  boxSelect: {
    group: "Canvas",
    label: "Box-select nodes",
    context: "Drag on the canvas background",
    keys: ["Drag"],
    modifier: "shift",
  },
  multiSelect: {
    group: "Canvas",
    label: "Select multiple nodes or connections",
    keys: ["Click"],
    modifier: "primary",
  },
  pan: {
    group: "Canvas",
    label: "Pan canvas",
    keys: ["Space + Drag", "Space + Scroll"],
  },
  zoom: {
    group: "Canvas",
    label: "Zoom canvas",
    keys: ["Scroll"],
    modifier: "primary",
  },
  removeFromCanvas: {
    group: "Canvas",
    label: "Remove selected nodes or connections from view",
    context: "Canvas only; does not delete services",
    keys: ["Backspace"],
  },
  changeTab: {
    group: "Service drawer",
    label: "Previous or next tab",
    context: "Service tab focused",
    keys: ["ArrowLeft", "ArrowRight"],
  },
  firstLastTab: {
    group: "Service drawer",
    label: "First or last tab",
    context: "Service tab focused; Home selects first, End selects last",
    keys: ["Home", "End"],
  },
  commandHistory: {
    group: "Service drawer",
    label: "Previous or next console command",
    context: "Console command field",
    keys: ["ArrowUp", "ArrowDown"],
  },
  runCommand: {
    group: "Service drawer",
    label: "Run console command",
    context: "Console command field",
    keys: ["Enter"],
  },
  runQuery: {
    group: "Service drawer",
    label: "Run SQL query",
    context: "Data tab SQL editor",
    keys: ["Enter"],
    modifier: "primary",
  },
  widenDrawer: {
    group: "Service drawer",
    label: "Widen drawer",
    context: "Resize handle focused; adds 24 px",
    keys: ["ArrowLeft", "ArrowUp"],
  },
  narrowDrawer: {
    group: "Service drawer",
    label: "Narrow drawer",
    context: "Resize handle focused; subtracts 24 px",
    keys: ["ArrowRight", "ArrowDown"],
  },
  resizeDrawerFaster: {
    group: "Service drawer",
    label: "Resize drawer in larger steps",
    context: "Resize handle focused; PageUp widens, PageDown narrows by 96 px",
    keys: ["PageUp", "PageDown"],
  },
  drawerWidthLimits: {
    group: "Service drawer",
    label: "Minimum or maximum drawer width",
    context: "Resize handle focused; Home minimizes, End maximizes",
    keys: ["Home", "End"],
  },
  resetDrawerWidth: {
    group: "Service drawer",
    label: "Reset drawer width",
    context: "Resize handle focused",
    keys: ["Enter", " "],
  },
} as const satisfies Record<string, Shortcut>;

const KEY_LABELS: Record<string, string> = {
  " ": "Space",
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowRight: "→",
  ArrowDown: "↓",
  PageUp: "Page Up",
  PageDown: "Page Down",
};

export function formatShortcutKeys(shortcut: Shortcut, platform: string): string[] {
  const modifier = shortcut.modifier === "primary"
    ? /Mac/i.test(platform) ? "⌘" : "Ctrl"
    : shortcut.modifier === "shift" ? "Shift" : null;
  return shortcut.keys.map((key) => {
    const label = KEY_LABELS[key] ?? key;
    return modifier ? `${modifier} + ${label}` : label;
  });
}

export function isTypingTarget(target: EventTarget | null): boolean {
  // Avoid browser globals so the guard is safe to import during server render.
  const node = target as Node | null;
  let element = node?.nodeType === 1 ? node as Element : node?.parentElement;
  if (!element || typeof element.getAttribute !== "function") return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.nodeName.toUpperCase())) return true;

  // contenteditable is inherited. The nearest valid value wins, including a
  // non-editable island inside an editor and plaintext-only editing hosts.
  while (element) {
    const value = element.getAttribute("contenteditable")?.toLowerCase();
    if (value === "false") return false;
    if (value === "" || value === "true" || value === "plaintext-only") return true;
    element = element.parentElement;
  }
  return false;
}

type ShortcutEvent = Pick<KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "defaultPrevented" |
  "repeat" | "isComposing" | "target"
>;

export function shouldOpenShortcuts(event: ShortcutEvent): boolean {
  return event.key === SHORTCUTS.help.keys[0] &&
    !event.ctrlKey && !event.metaKey && !event.altKey &&
    !event.defaultPrevented && !event.repeat && !event.isComposing &&
    !isTypingTarget(event.target);
}
