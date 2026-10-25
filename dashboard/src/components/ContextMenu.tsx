"use client";

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useDialogFocus } from "@/components/use-focus-trap";
import { dismissAfterMenuFocusSettles, isContextMenuKey, menuKeyResult, menuPosition, prefersNativeContextMenu, shouldCloseMenu, submenuPosition, type MenuItem } from "@/lib/context-menu";
import { cn } from "@/lib/utils";

export type ContextMenuItem = Omit<MenuItem, "children"> & {
  onSelect?: () => void | Promise<void>;
  children?: ContextMenuItem[];
};
export interface ContextMenuTriggerProps {
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onKeyDownCapture: (event: React.KeyboardEvent<HTMLElement>) => void;
  "aria-haspopup": "menu" | undefined;
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  "data-context-menu-trigger": true;
  tabIndex: number;
}

interface MenuButtonProps {
  type: "button";
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
}

/** Render props preserve the card/row's layout and existing primary action. */
export function ContextMenu({ label, heading, items, children, background = false, onBeforeOpen }: {
  label: string;
  heading?: string;
  items: ContextMenuItem[];
  children: (props: ContextMenuTriggerProps, buttonProps: MenuButtonProps) => React.ReactNode;
  background?: boolean;
  onBeforeOpen?: () => void;
}) {
  const id = useId();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setPoint(null), []);

  function canOpen(event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) {
    const target = event.target;
    if (event.defaultPrevented || !(target instanceof Element) || !items.length) return false;
    if (target.closest("[data-context-menu-trigger]") !== event.currentTarget) return false;
    if (background && target !== event.currentTarget && target.closest("button, a, [role='button'], [role='dialog'], .react-flow__node, .react-flow__edge, .react-flow__controls, .react-flow__minimap")) return false;
    return !prefersNativeContextMenu({
      editable: !!target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"),
      selection: window.getSelection()?.isCollapsed === false,
      nativeTarget: !!target.closest("pre, code, [role='log'], [data-native-context-menu], .monaco-editor, .cm-editor, .xterm"),
    });
  }

  function open(event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, position: { x: number; y: number }) {
    event.preventDefault();
    event.stopPropagation();
    // Selecting a service is distinct from opening its drawer.
    if (onBeforeOpen) flushSync(onBeforeOpen);
    // Right-click need not focus its target. Establish an opener for the shared
    // focus stack before mounting the menu (including menus inside a drawer).
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("button, a[href], [tabindex]") : null;
    (target && !target.matches(":disabled") && event.currentTarget.contains(target) ? target : event.currentTarget).focus({ preventScroll: true });
    setError(null);
    setPoint(position);
  }

  function select(item: ContextMenuItem) {
    if (item.disabledReason || !item.onSelect || item.children?.length) return;
    // Restore focus before opening another dialog or a native confirmation.
    flushSync(close);
    try {
      const result = item.onSelect();
      if (result) void result.catch(() => setError(`Could not ${item.label.toLowerCase()}. Please try again.`));
    } catch {
      setError(`Could not ${item.label.toLowerCase()}. Please try again.`);
    }
  }

  return (
    <>
      {children({
        tabIndex: items.length ? 0 : -1,
        "data-context-menu-trigger": true,
        "aria-haspopup": items.length ? "menu" : undefined,
        "aria-expanded": point !== null,
        "aria-controls": point ? id : undefined,
        onContextMenu: (event) => {
          if (canOpen(event)) open(event, { x: event.clientX, y: event.clientY });
        },
        onKeyDownCapture: (event) => {
          if (!isContextMenuKey(event.key, event.shiftKey) || !canOpen(event)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          open(event, { x: rect.left, y: rect.bottom });
        },
      }, {
        type: "button",
        "aria-haspopup": "menu",
        "aria-expanded": point !== null,
        "aria-controls": point ? id : undefined,
        onClick: (event) => {
          event.stopPropagation();
          if (point) close();
          else {
            const rect = event.currentTarget.getBoundingClientRect();
            open(event, { x: rect.left, y: rect.bottom });
          }
        },
      })}
      {point && createPortal(
        <MenuPopup id={id} label={label} heading={heading} items={items} point={point} onClose={close} onCloseAll={close} onSelect={select} />,
        document.body
      )}
      {error && createPortal(
        <p role="alert" className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-[var(--color-danger)] bg-[var(--color-bg-elevated)] px-4 py-2 text-xs text-[var(--color-danger)]">{error}</p>,
        document.body
      )}
    </>
  );
}

function MenuPopup({ id, label, heading, items, point, anchor, onClose, onCloseAll, onSelect }: {
  id: string;
  label: string;
  heading?: string;
  items: ContextMenuItem[];
  point: { x: number; y: number };
  anchor?: { left: number; right: number; top: number };
  onClose: () => void;
  onCloseAll: () => void;
  onSelect: (item: ContextMenuItem) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [child, setChild] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const closeChild = useCallback(() => setChild(null), []);
  const childItem = items.find((item) => item.id === child?.id);
  // Reuse the overlay stack so Escape closes only the menu, not its drawer.
  const focusRef = useDialogFocus<HTMLDivElement>(onClose, { trapTab: false, preventScroll: true });
  const ref = useCallback((node: HTMLDivElement | null) => {
    panel.current = node;
    focusRef(node);
  }, [focusRef]);

  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const position = anchor ? submenuPosition(anchor, node.getBoundingClientRect(), viewport)
      : menuPosition(point, node.getBoundingClientRect(), viewport);
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
  }, [point, anchor, items]);

  useEffect(() => {
    // Submenus are DOM descendants, so the root owns outside/blur/scroll close.
    if (anchor) return;
    const dismiss = (event: Event) => {
      if (event.type === "focusin") {
        // The shared focus trap briefly restores its opener while re-arming
        // (also in Strict Mode). Check settled focus, not that transient event.
        dismissAfterMenuFocusSettles(() => panel.current?.contains(document.activeElement) ?? null, onCloseAll);
        return;
      }
      const inside = event.target instanceof Node && !!panel.current?.contains(event.target);
      if (shouldCloseMenu(event.type as Parameters<typeof shouldCloseMenu>[0], inside)) onCloseAll();
    };
    const documentEvents = ["pointerdown", "focusin", "scroll", "wheel"] as const;
    for (const type of documentEvents) document.addEventListener(type, dismiss, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      for (const type of documentEvents) document.removeEventListener(type, dismiss, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor, onCloseAll]);

  function openChild(item: ContextMenuItem, button: HTMLButtonElement) {
    if (item.disabledReason || !item.children?.length) return;
    if (child?.id === item.id) {
      document.getElementById(`${id}-${item.id}`)?.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
      return;
    }
    button.focus({ preventScroll: true });
    setChild({ id: item.id, anchor: button.getBoundingClientRect() });
  }

  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label={label}
      style={{ left: point.x, top: point.y }}
      className="fixed z-[60] max-h-[calc(100vh-1rem)] min-w-48 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 shadow-2xl"
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
          .filter((button) => button.closest("[role='menu']") === event.currentTarget);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const result = menuKeyResult(event.key, index, items, !!anchor);
        if (result.type !== "none" || event.key === "Enter" || event.key === " ") event.preventDefault();
        if (result.type === "focus") {
          buttons[result.index]?.focus({ preventScroll: true });
          buttons[result.index]?.scrollIntoView({ block: "nearest" });
        }
        else if (result.type === "activate") onSelect(items[result.index]);
        else if (result.type === "open-submenu") openChild(items[result.index], buttons[result.index]);
        else if (result.type === "close-submenu") onClose();
        else if (result.type === "close") onCloseAll();
      }}
    >
      {heading && <div className="px-3 py-2 text-[11px] font-medium text-[var(--color-fg-subtle)]">{heading}</div>}
      {items.map((item, index) => (
        <Fragment key={item.id}>
        {item.separatorBefore && index > 0 && <div role="separator" className="my-1 border-t border-[var(--color-border)]" />}
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          data-autofocus={index === 0 ? "" : undefined}
          aria-disabled={!!item.disabledReason}
          aria-haspopup={item.children?.length ? "menu" : undefined}
          aria-expanded={item.children?.length ? child?.id === item.id : undefined}
          aria-controls={child?.id === item.id ? `${id}-${item.id}` : undefined}
          title={item.disabledReason ?? item.description}
          onFocus={() => { if (child && child.id !== item.id) closeChild(); }}
          onClick={(event) => item.children?.length ? openChild(item, event.currentTarget) : onSelect(item)}
          className={cn(
            "flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-xs outline-none hover:bg-[var(--color-surface-hover)] focus:bg-[var(--color-surface-hover)] focus:ring-1 focus:ring-inset focus:ring-[var(--color-brand)]",
            item.destructive ? "text-[var(--color-danger)]" : "text-[var(--color-fg)]",
            item.disabledReason && "cursor-not-allowed opacity-40"
          )}
        >
          {item.label}
          {!!item.children?.length && <span aria-hidden="true">›</span>}
        </button>
        </Fragment>
      ))}
      {child && childItem?.children?.length && !childItem.disabledReason && (
        <MenuPopup
          key={child.id}
          id={`${id}-${child.id}`}
          label={childItem.label}
          items={childItem.children}
          point={{ x: child.anchor.right, y: child.anchor.top }}
          anchor={child.anchor}
          onClose={closeChild}
          onCloseAll={onCloseAll}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}
