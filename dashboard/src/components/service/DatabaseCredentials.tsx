"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { loadDatabasePasswordAction } from "@/app/actions";
import type { Database } from "@/lib/dokploy";
import { connectionString } from "@/lib/connection";
import { CopyButton, Field } from "@/components/service/primitives";

/** Mounted only by the open Overview or Settings tab, never seeded from page props. */
export function DatabaseCredentials({ db, passwordOnly = false }: { db: Database; passwordOnly?: boolean }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadDatabasePasswordAction>> | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let live = true;
    loadDatabasePasswordAction(db.engine, db.id).then((value) => {
      if (live) setResult(value);
    }).catch(() => {
      if (live) setResult({ ok: false, error: "Could not load database credentials." });
    });
    return () => { live = false; };
  }, [db.engine, db.id]);

  const label = passwordOnly ? "Password" : "Connection string";
  if (!result) {
    return <Field label={label}><p role="status" className="text-xs text-[var(--color-fg-subtle)]">Loading database credentials…</p></Field>;
  }
  if (!result.ok) {
    return <Field label={label}><p role="alert" className="text-xs text-[var(--color-danger)]">{result.error}</p></Field>;
  }
  const value = passwordOnly ? result.password : connectionString({ ...db, databasePassword: result.password });
  if (!value) return null;

  return (
    <Field label={label} hint={passwordOnly ? "rotation coming soon" : undefined}>
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2.5">
        <code className="flex-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
          {passwordOnly && !show ? "•".repeat(16) : value}
        </code>
        {passwordOnly && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          >
            {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
        <CopyButton text={value} />
      </div>
    </Field>
  );
}
