"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { Database } from "@/lib/dokploy";
import { databaseCredentialValue } from "@/lib/database-credentials";
import { loadDatabasePasswordAction } from "@/app/actions";
import { CopyButton, Field } from "@/components/service/primitives";

export function DatabaseCredentials({ db, kind }: { db: Database; kind: "connection" | "password" }) {
  const [password, setPassword] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const shown = password !== undefined;
  const label = kind === "connection" ? "connection string" : "password";
  const value = databaseCredentialValue(db, password, kind);

  function toggle() {
    setError(null);
    if (shown) {
      setPassword(undefined);
      return;
    }
    startLoad(async () => {
      try {
        const result = await loadDatabasePasswordAction(db.engine, db.id);
        if (result.ok) setPassword(result.password);
        else setError(result.error);
      } catch {
        setError("Could not load database credentials. Try again.");
      }
    });
  }

  return (
    <Field label={kind === "connection" ? "Connection string" : "Password"} hint={kind === "password" ? "rotation coming soon" : undefined}>
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2.5">
        <code className="flex-1 truncate font-mono text-xs text-[var(--color-fg-muted)]">
          {loading ? "Loading…" : shown ? value ?? "No password set" : "•".repeat(16)}
        </code>
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          aria-label={`${shown ? "Hide" : "Show"} ${label}`}
          aria-pressed={shown}
          className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        {shown && value && <CopyButton text={value} />}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </Field>
  );
}
