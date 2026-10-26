"use client";

import { useId, useRef, useState } from "react";
import { applyReferenceCompletion, getReferenceCompletion, referenceOptionIndex, type ReferenceSuggestion } from "@/lib/variable-references";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/components/use-focus-trap";

/** The menu contains names only; selecting one inserts its template reference. */
export function VariableValueInput({ value, editingKey, label, disabled, suggestions, invalid, describedBy, onChange, className }: {
  value: string;
  editingKey: string;
  label: string;
  disabled: boolean;
  suggestions: ReferenceSuggestion[];
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  className: string;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const completion = caret === null ? null : getReferenceCompletion(value, caret, suggestions, editingKey);
  const selected = Math.min(active, (completion?.suggestions.length ?? 1) - 1);
  const popupRef = useDialogFocus<HTMLDivElement>(() => setCaret(null), { trapTab: false, preventScroll: true, restoreFocus: false });

  function select(suggestion: ReferenceSuggestion) {
    if (!completion) return;
    const next = applyReferenceCompletion(value, completion, suggestion);
    onChange(next.value);
    setCaret(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <div ref={completion ? popupRef : null} className="relative">
      <textarea
        ref={input}
        data-autofocus
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={!!completion}
        aria-controls={completion ? id : undefined}
        aria-activedescendant={completion && selected >= 0 ? `${id}-${selected}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        value={value}
        rows={Math.min(6, value.split("\n").length)}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        placeholder="Value or ${{Service.VAR}}"
        className={`${className} block resize-y`}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setActive(0);
        }}
        onClick={(event) => { setCaret(event.currentTarget.selectionStart); setActive(0); }}
        onBlur={() => setCaret(null)}
        onKeyDown={(event) => {
          if (!completion) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setCaret(null);
          } else if (completion.suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const next = referenceOptionIndex(selected, event.key, completion.suggestions.length);
            setActive(next);
            document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: "nearest" });
          } else if (completion.suggestions.length && (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey))) {
            event.preventDefault();
            select(completion.suggestions[selected]);
          }
        }}
        onKeyUp={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            setCaret(event.currentTarget.selectionStart);
            setActive(0);
          }
        }}
      />
      {completion && (
        <div className="absolute top-full left-0 z-20 mt-1 w-full min-w-56 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-xl">
          <ul id={id} role="listbox" aria-label="Variable references" className="max-h-52 overflow-auto p-1">
            {completion.suggestions.map((suggestion, index) => (
              <li
                id={`${id}-${index}`}
                key={suggestion.label}
                role="option"
                aria-selected={selected === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(suggestion)}
                className={cn("cursor-pointer break-all rounded px-2 py-1.5 font-mono text-xs hover:bg-[var(--color-surface-hover)]", selected === index && "bg-[var(--color-surface-hover)]")}
              >
                {suggestion.label}
                {suggestion.kind === "builtin" && <span className="ml-2 font-sans text-[10px] text-[var(--color-fg-subtle)]">Built-in</span>}
              </li>
            ))}
            {!completion.suggestions.length && <li role="option" aria-disabled="true" aria-selected="false" className="p-2 text-xs text-[var(--color-fg-subtle)]">No matching variables in this environment.</li>}
          </ul>
          {completion.hiddenCount > 0 && <p role="status" className="border-t border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-fg-subtle)]">{completion.hiddenCount} more, keep typing</p>}
        </div>
      )}
    </div>
  );
}
