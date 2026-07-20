"use client";

/**
 * Focus management for dialogs, drawers and popovers (WCAG 2.1.1 / 2.4.3):
 * when the panel appears move focus in, trap Tab inside, close on Escape, and
 * restore focus to the opener when it goes away. Stacked overlays (a popup
 * that opens a modal) only let the topmost one handle keys.
 *
 * Returns a callback ref so it also works for panels rendered conditionally
 * (e.g. inside AnimatePresence) by an always-mounted component:
 *
 *   const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
 *   {open && <div ref={dialogRef} role="dialog" aria-modal="true">…</div>}
 *
 * Mark a child with data-autofocus to receive initial focus instead of the
 * container itself.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stack: HTMLElement[] = [];

const visible = (el: HTMLElement) => el.getClientRects().length > 0;

export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const nodeRef = useRef<T | null>(null);
  // The trap re-arms when the attached node changes, not on every render.
  const [version, setVersion] = useState(0);
  // Callers pass inline closures; track the latest without re-arming the trap.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const setPanel = useCallback((node: T | null) => {
    if (nodeRef.current === node) return;
    nodeRef.current = node;
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const panel = nodeRef.current;
    if (!panel) return;
    stack.push(panel);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const initial = panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    if (initial === panel && !panel.hasAttribute("tabindex")) panel.tabIndex = -1;
    initial.focus();

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== panel) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && panel.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(panel), 1);
      // No-op if the opener unmounted with the dialog.
      opener?.focus();
    };
  }, [version]);

  return setPanel;
}
