"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { Database } from "@/lib/dokploy";
import { connectionString } from "@/lib/connection";
import { loadDatabasePasswordAction } from "@/app/actions";
import { CopyButton, Field } from "@/components/service/primitives";

/** Credentials never come from page props, including when a drawer is linked directly. */
export function DatabaseCredentials({ db, connection = false }: { db: Database; connection?: boolean }) {
  const [password, setPassword] = useState<string | null | undefined>(undefined);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = connection ? "connection string" : "password";
  const value = password === undefined ? null : connection
    ? connectionString({ ...db, databasePassword: password }) : password;

  function reveal() {
    if (password !== undefined) {
      setShow((current) => !current);
      return;
    }
    setError(null);
    start(async () => {
      try {
        const result = await loadDatabasePasswordAction(db.engine, db.id);
        if (result.ok) {
          setPassword(result.password);
          setShow(true);
        } else setError(result.error);
      } catch {
        setError("Could not load database credentials.");
      }
    });
  }

  return (
    <Field label={connection ? "Connection string" : "Password"}>
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2.5">
        <code className="flex-1 truncate font-mono text-xs text-[var(--color-fg-muted)]">
          {show ? value || "—" : "•".repeat(16)}
        </code>
        <button
          type="button"
          onClick={reveal}
          disabled={pending}
          aria-label={show ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={show}
          className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        {show && value && <CopyButton text={value} />}
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
    </Field>
  );
}
