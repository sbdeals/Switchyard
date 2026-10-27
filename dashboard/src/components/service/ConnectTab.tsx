"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import type { Database } from "@/lib/dokploy";
import { buildDatabaseConnection, databaseConnectionDetails } from "@/lib/db-connect";
import { getDatabaseConnectionAction } from "@/app/db-connect-actions";
import { Field, Info, useSavedFlash } from "@/components/service/primitives";

const MASK = "••••••••";

/** Credentials are loaded only by an explicit reveal/copy, never on mount. */
export function ConnectTab({ db }: { db: Database }) {
  const details = databaseConnectionDetails(db);
  const internal = details.host ? buildDatabaseConnection(db, MASK) : null;
  const endpoint = db.externalPort
    ? { host: db.externalHost || "SERVER_HOST", port: db.externalPort }
    : undefined;
  const external = endpoint ? buildDatabaseConnection(db, MASK, endpoint) : null;
  const preview = (value: string) => value.replace(encodeURIComponent(MASK), MASK);

  async function password() {
    const result = await getDatabaseConnectionAction(db.engine, db.id);
    if (!result.ok) throw new Error("Could not load connection details. Try again.");
    return result.password;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium">Internal connection</h3>
        <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
          Reach this database from services on <code>dokploy-network</code>.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Info label="Host" value={details.host || "Unavailable"} mono />
        <Info label="Port" value={String(details.port)} mono />
        <Info label="User" value={details.user || "—"} mono />
        <Info label="Database" value={details.database || "—"} mono />
      </div>
      <SecretValue label="Password" preview={MASK} load={password} />
      {internal ? (
        <>
          <SecretValue
            label="Internal URI"
            preview={preview(internal.uri)}
            load={async () => buildDatabaseConnection(db, await password()).uri}
          />
          <SecretValue
            label="CLI command"
            preview={preview(internal.cli)}
            load={async () => buildDatabaseConnection(db, await password()).cli}
          />
        </>
      ) : (
        <p className="text-xs text-[var(--color-fg-muted)]">The internal hostname is unavailable.</p>
      )}
      <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
        <h3 className="text-sm font-medium">External connection</h3>
        {external && endpoint ? (
          <>
            <SecretValue
              label="External URI"
              preview={preview(external.uri)}
              load={async () => buildDatabaseConnection(db, await password(), endpoint).uri}
            />
            {!db.externalHost && (
              <p className="text-xs text-[var(--color-fg-muted)]">
                Replace <code>SERVER_HOST</code> with your database server&apos;s reachable hostname or IP.
              </p>
            )}
            <p className="text-xs text-[var(--color-fg-muted)]">
              Port {db.externalPort} is configured. The database must be running and your server&apos;s firewall must allow this port.
              Manage the external port in Settings.
            </p>
          </>
        ) : (
          <p className="text-xs text-[var(--color-fg-muted)]">
            This database is internal only. To expose it, set an External port in Settings and allow that port through your server&apos;s firewall.
          </p>
        )}
      </div>
    </div>
  );
}

function SecretValue({ label, preview, load }: { label: string; preview: string; load: () => Promise<string> }) {
  const [value, setValue] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, flash] = useSavedFlash(1200);
  const shown = value !== null;
  const buttonCls = "shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40";

  function read(copy: boolean) {
    setError(null);
    start(async () => {
      let result: string;
      try {
        result = await load();
      } catch {
        setError("Could not load connection details. Try again.");
        return;
      }
      if (!copy) {
        setValue(result);
        return;
      }
      try {
        await navigator.clipboard.writeText(result);
        flash();
      } catch {
        setError("Could not copy. Reveal the value to copy it manually.");
      }
    });
  }

  return (
    <Field label={label}>
      <div className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-code-bg)] p-2.5">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--color-fg-muted)]">
          {shown ? value : preview}
        </code>
        <button
          type="button"
          disabled={pending}
          onClick={() => shown ? setValue(null) : read(false)}
          aria-label={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={shown}
          className={buttonCls}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => read(true)}
          aria-label={`Copy ${label.toLowerCase()}`}
          className={buttonCls}
        >
          {copied ? <Check className="size-3.5 text-[var(--color-ok)]" /> : <Copy className="size-3.5" />}
          <span aria-live="polite" className="sr-only">{copied ? "Copied" : ""}</span>
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </Field>
  );
}
