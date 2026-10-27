"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Trash2 } from "lucide-react";
import { useDialogFocus } from "@/components/use-focus-trap";
import { nameMatches } from "@/lib/delete-impact";

/** Mount only while open so each confirmation starts with an empty name. */
export function DeleteConfirmDialog({
  name,
  resource,
  impact,
  onConfirm,
  onClose,
  onDeleted,
  volumeNotice = true,
}: {
  name: string;
  resource: string;
  impact: string[];
  onConfirm: () => Promise<{ ok: boolean }>;
  onClose: () => void;
  onDeleted: () => void;
  volumeNotice?: boolean;
}) {
  const id = useId();
  const [typedName, setTypedName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const submitting = useRef(false);
  const close = () => {
    if (!submitting.current) onClose();
  };
  const ref = useDialogFocus<HTMLDivElement>(close);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || !nameMatches(typedName, name)) return;
    submitting.current = true;
    setPending(true);
    setError(false);
    try {
      const result = await onConfirm();
      if (!result.ok) {
        setError(true);
        return;
      }
    } catch {
      setError(true);
      return;
    } finally {
      submitting.current = false;
      setPending(false);
    }
    onDeleted();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-2xl"
      >
        <h2 id={`${id}-title`} className="text-base font-semibold">Delete {resource}?</h2>
        <p id={`${id}-description`} className="mt-2 break-words text-sm text-[var(--color-fg-muted)]">
          Deleting <strong className="text-[var(--color-fg)]">{name}</strong> cannot be undone.
          The following will be removed:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--color-fg-muted)]">
          {impact.map((item) => <li key={item}>{item}</li>)}
        </ul>
        {volumeNotice && (
          <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">
            Named-volume data may persist on the host after deletion.
          </p>
        )}
        <form onSubmit={submit} className="mt-5 space-y-3" aria-busy={pending}>
          <label htmlFor={`${id}-name`} className="block break-words text-xs text-[var(--color-fg-muted)]">
            Type <strong className="text-[var(--color-fg)]">{name}</strong> to confirm (case-sensitive).
          </label>
          <input
            id={`${id}-name`}
            data-autofocus
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
          />
          {error && (
            <p role="alert" className="text-xs text-[var(--color-danger)]">
              Could not delete this {resource}. Please try again.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={close} disabled={pending} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium hover:bg-[var(--color-surface)] disabled:opacity-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !nameMatches(typedName, name)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-danger)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {pending ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <Trash2 aria-hidden="true" className="size-3.5" />}
              {pending ? "Deleting…" : `Delete ${resource}`}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
