"use client";

import { useEffect, useId, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { useDialogFocus } from "@/components/use-focus-trap";
import {
  SHORTCUT_GROUPS,
  SHORTCUTS,
  formatShortcutKeys,
  shouldOpenShortcuts,
  type Shortcut,
} from "@/lib/shortcuts";

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shouldOpenShortcuts(event)) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Keyboard shortcuts"
        aria-keyshortcuts={SHORTCUTS.help.keys[0]}
        aria-haspopup="dialog"
        title={`Keyboard shortcuts (${SHORTCUTS.help.keys[0]})`}
        className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-sm font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
      >
        {SHORTCUTS.help.keys[0]}
      </button>
      {open && <ShortcutsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const platform = navigator.platform;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold">
              <Keyboard className="size-4 text-[var(--color-brand)]" /> Keyboard shortcuts
            </h2>
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              Shortcuts work in the focused area. Press ? outside text fields to open this guide.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-autofocus
            aria-label="Close keyboard shortcuts"
            className="ml-3 rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <X className="size-4" />
          </button>
        </div>
        <div tabIndex={0} aria-label="Shortcut list" className="min-h-0 space-y-5 overflow-y-auto px-5 py-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group}>
              <h3 className="mb-2 text-xs font-semibold text-[var(--color-brand)]">{group}</h3>
              <dl className="divide-y divide-[var(--color-border)]">
                {Object.entries<Shortcut>(SHORTCUTS).filter(([, shortcut]) => shortcut.group === group).map(([id, shortcut]) => (
                  <div key={id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                    <dt className="text-xs">
                      {shortcut.label}
                      {shortcut.context && <span className="mt-0.5 block text-[11px] text-[var(--color-fg-subtle)]">{shortcut.context}</span>}
                    </dt>
                    <dd className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-fg-muted)]">
                      {formatShortcutKeys(shortcut, platform).map((keys, index) => (
                        <span key={keys} className="inline-flex items-center gap-1.5">
                          {index > 0 && <span>or</span>}
                          <kbd className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[var(--color-fg)]">{keys}</kbd>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="border-t border-[var(--color-border)] px-5 py-3 text-right text-[11px] text-[var(--color-fg-subtle)]">
          <kbd className="font-mono">{formatShortcutKeys(SHORTCUTS.close, platform)[0]}</kbd> to close
        </div>
      </div>
    </div>
  );
}
