"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MoreVertical, Check, X, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { useDialogFocus } from "@/components/use-focus-trap";

export interface StagedChangeView {
  id: string;
  kind: string;
  description: string;
  createdAt: number;
}

export interface ApplyResult {
  id: string;
  description: string;
  ok: boolean;
  error?: string;
}

export function ChangesBar({
  changes,
  busy,
  results,
  onApply,
  onDiscard,
  onDismissResults,
}: {
  changes: StagedChangeView[];
  busy: boolean;
  results: ApplyResult[] | null;
  onApply: (ids?: string[]) => void;
  onDiscard: (ids?: string[]) => void;
  onDismissResults: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const count = changes.length;
  if (count === 0 && !results) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4">
      <AnimatePresence mode="popLayout">
        {count > 0 && (
          <motion.div
            key="bar"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="pointer-events-auto flex items-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)]/95 px-2 py-1.5 shadow-[0_10px_30px_-12px_#000] backdrop-blur"
          >
            <span className="flex items-center gap-2 pl-1.5 pr-1 text-xs font-medium text-[var(--color-fg)]">
              <span className="flex size-5 items-center justify-center rounded-md bg-[var(--color-warn-soft)] text-[var(--color-warn)]">
                {count}
              </span>
              {count === 1 ? "1 change" : `${count} changes`} pending
            </span>

            <button
              onClick={() => setDetailsOpen(true)}
              className="rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
            >
              Details
            </button>

            <button
              onClick={() => onApply()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Apply {count === 1 ? "1 change" : `${count} changes`}
            </button>

            <div className="relative" ref={menuRef}>
              <button
                ref={menuTriggerRef}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="rounded-lg p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                aria-label="More"
              >
                <MoreVertical className="size-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] py-1 shadow-[0_10px_30px_-12px_#000]">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onDiscard();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-danger)]"
                  >
                    <Trash2 className="size-3.5" /> Discard changes
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Apply results toast (auto-shown by parent lifetime) */}
      {results && count === 0 && (
        <div
          role="status"
          className="pointer-events-auto flex items-start gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)]/95 px-3 py-2 text-xs shadow-[0_10px_30px_-12px_#000] backdrop-blur"
        >
          <div className="flex flex-col gap-1">
            {results.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                {r.ok ? (
                  <Check className="size-3.5 shrink-0 text-[var(--color-ok)]" />
                ) : (
                  <AlertTriangle className="size-3.5 shrink-0 text-[var(--color-danger)]" />
                )}
                <span className={r.ok ? "text-[var(--color-fg-muted)]" : "text-[var(--color-danger)]"}>
                  {r.description}
                  {!r.ok && r.error ? ` — ${r.error}` : ""}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={onDismissResults}
            aria-label="Dismiss results"
            className="-mr-1 shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Details modal */}
      {detailsOpen && (
        <DetailsModal
          changes={changes}
          busy={busy}
          onApply={onApply}
          onDiscard={onDiscard}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The pending-changes dialog, split out so it mounts and unmounts with the
 * overlay — useDialogFocus (whose effect runs on mount) traps focus for
 * exactly the dialog's lifetime.
 */
function DetailsModal({
  changes,
  busy,
  onApply,
  onDiscard,
  onClose,
}: {
  changes: StagedChangeView[];
  busy: boolean;
  onApply: (ids?: string[]) => void;
  onDiscard: (ids?: string[]) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 id={titleId} className="text-sm font-semibold">
            Pending changes
          </h3>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {changes.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            >
              <span className="text-xs text-[var(--color-fg)]">{c.description}</span>
              <button
                onClick={() => onDiscard([c.id])}
                className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-danger)]"
                aria-label="Discard this change"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {changes.length === 0 && (
            <p className="py-4 text-center text-xs text-[var(--color-fg-subtle)]">No pending changes.</p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => onDiscard()}
            className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]"
          >
            Discard all
          </button>
          <button
            onClick={() => {
              onApply();
              onClose();
            }}
            disabled={busy || changes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Apply all
          </button>
        </div>
      </div>
    </div>
  );
}
