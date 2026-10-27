"use client";

import { useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import { useSavedFlash } from "@/components/service/primitives";

export function CopyLinkButton() {
  const [copied, flashCopied] = useSavedFlash();
  const [error, setError] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setError(false);
      flashCopied();
    } catch {
      setError(true);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
      >
        <LinkIcon className="size-3.5" />
        {copied ? "Copied!" : "Copy link"}
      </button>
      {error && <p role="status" className="text-xs text-[var(--color-danger)]">Copy the URL from your address bar.</p>}
    </div>
  );
}
