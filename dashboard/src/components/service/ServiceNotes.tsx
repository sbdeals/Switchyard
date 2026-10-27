"use client";

import { useId, useRef, useState, useTransition } from "react";
import { saveServiceNotesAction } from "@/app/actions";
import {
  capServiceNotesLength,
  normalizeServiceNotes,
  SERVICE_NOTES_MAX_LENGTH,
} from "@/lib/service-notes";
import { inputCls } from "@/components/service/primitives";

export function ServiceNotes({ id, description }: { id: string; description: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const helpId = useId();
  const editButton = useRef<HTMLButtonElement>(null);

  const finish = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };

  const save = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveServiceNotesAction(id, normalizeServiceNotes(draft));
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(true);
        finish();
      } catch {
        setError("Could not save service notes. Please try again.");
      }
    });
  };

  return (
    <div className="mt-3 text-xs">
      {editing ? (
        <div
          data-escape-handled
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (!pending) {
                setError(null);
                finish();
              }
            }
          }}
        >
          <textarea
            autoFocus
            aria-label="Service notes"
            aria-describedby={helpId}
            value={draft}
            onChange={(e) => setDraft(capServiceNotesLength(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                save();
              }
            }}
            maxLength={SERVICE_NOTES_MAX_LENGTH}
            readOnly={pending}
            rows={3}
            className={`${inputCls} resize-y`}
          />
          <div id={helpId} className="mt-1 flex justify-between gap-2 text-[10px] text-[var(--color-fg-subtle)]">
            <span>Enter to save · Shift+Enter for newline · Esc to cancel</span>
            <span className="shrink-0">{draft.length}/{SERVICE_NOTES_MAX_LENGTH}</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" disabled={pending} onClick={save} className="text-[var(--color-brand)] disabled:opacity-50">
              Save
            </button>
            <button type="button" disabled={pending} onClick={() => { setError(null); finish(); }} className="text-[var(--color-fg-muted)] disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={editButton}
          type="button"
          aria-label="Edit service notes"
          onClick={() => {
            setDraft(capServiceNotesLength(description ?? ""));
            setSaved(false);
            setError(null);
            setEditing(true);
          }}
          className="max-h-28 w-full overflow-auto whitespace-pre-wrap break-words rounded-md text-left text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)]"
        >
          {description || "Add a description…"}
        </button>
      )}
      <div role="status" aria-live="polite" className="mt-1 text-[11px] text-[var(--color-fg-muted)]">
        {pending ? "Saving…" : saved ? "Saved" : ""}
      </div>
      {error && <p role="alert" className="mt-1 text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
