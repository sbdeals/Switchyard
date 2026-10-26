"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { Database } from "@/lib/dokploy";
import { connectionString } from "@/lib/connection";
import { loadDatabasePasswordAction } from "@/app/actions";
import { CopyButton, Field } from "@/components/service/primitives";

export function DatabaseCredentials({ db, view }: { db: Database; view: "connection" | "password" }) {
  const [password, setPassword] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let live = true;
    loadDatabasePasswordAction(db.engine, db.id).then((res) => {
      if (!live) return;
      if (res.ok) setPassword(res.password);
      else setError(res.error);
    }).catch(() => {
      if (live) setError("Could not load database credentials.");
    });
    return () => {
      live = false;
    };
  }, [db.engine, db.id]);

  if (error) return <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>;
  if (password === undefined) {
    return (
      <div role="status" aria-label="Loading database credentials" className="h-10 animate-pulse rounded-lg bg-[var(--color-surface-hover)]">
        <span className="sr-only">Loading database credentials…</span>
      </div>
    );
  }

  if (view === "connection") {
    const conn = connectionString({ ...db, databasePassword: password });
    if (!conn) return null;
    return (
      <Field label="Connection string">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2.5">
          <code className="flex-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
            {conn}
          </code>
          <CopyButton text={conn} />
        </div>
      </Field>
    );
  }

  if (!password) return null;
  return (
    <Field label="Password" hint="rotation coming soon">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2">
        <code className="flex-1 truncate font-mono text-xs text-[var(--color-fg-muted)]">
          {show ? password : "•".repeat(16)}
        </code>
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <CopyButton text={password} />
      </div>
    </Field>
  );
}
