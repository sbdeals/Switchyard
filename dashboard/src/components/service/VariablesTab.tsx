"use client";

import { useState, useTransition } from "react";
import type { Service } from "@/lib/dokploy";
import {
  saveEnvironmentAction,
  saveApplicationEnvAction,
  saveComposeEnvAction,
} from "@/app/actions";
import { SaveRow, useSavedFlash } from "@/components/service/primitives";

export function VariablesTab({ service }: { service: Service }) {
  const [value, setValue] = useState(service.env ?? "");
  const [pending, start] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== (service.env ?? "");
  const count = value.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;

  function save() {
    setError(null);
    start(async () => {
      const res =
        service.kind === "database"
          ? await saveEnvironmentAction(service.engine, service.id, value)
          : service.kind === "compose"
            ? await saveComposeEnvAction(service.id, value)
            : await saveApplicationEnvAction(service.id, value);
      if (res.ok) flashSaved();
      else setError(res.error);
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
        aria-label="Environment variables, one KEY=value per line"
        className="min-h-64 flex-1 resize-none rounded-lg border border-[var(--color-border-control)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
      />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[var(--color-fg-subtle)]">{count} variable{count === 1 ? "" : "s"}</span>
        <SaveRow saving={pending} saved={saved} error={error} disabled={!dirty} onSave={save} label="Save variables" />
      </div>
    </div>
  );
}
