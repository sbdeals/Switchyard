"use client";

import { useState, useTransition } from "react";
import { Loader2, Check, AlertCircle } from "lucide-react";
import type { Service } from "@/lib/dokploy";
import { saveEnvironmentAction, saveApplicationEnvAction } from "@/app/actions";

export function VariablesTab({ service }: { service: Service }) {
  const [value, setValue] = useState(service.env ?? "");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== (service.env ?? "");
  const count = value.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const res =
        service.kind === "database"
          ? await saveEnvironmentAction(service.engine, service.id, value)
          : await saveApplicationEnvAction(service.id, value);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } else setError(res.error);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-xs text-[var(--color-fg-muted)]">
        One <code className="font-mono">KEY=value</code> per line. Redeploy the service for
        changes to take effect.
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        placeholder={"DATABASE_URL=postgres://…\nLOG_LEVEL=info"}
        className="min-h-64 flex-1 resize-none rounded-lg border border-[var(--color-border-strong)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]"
      />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[var(--color-fg-subtle)]">{count} variable{count === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          {error && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-danger)]">
              <AlertCircle className="size-3.5" /> {error}
            </span>
          )}
          {saved && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-ok)]">
              <Check className="size-3.5" /> Saved
            </span>
          )}
          <button
            onClick={save}
            disabled={pending || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save variables
          </button>
        </div>
      </div>
    </div>
  );
}
