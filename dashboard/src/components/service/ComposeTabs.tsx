"use client";

import { useState, useTransition } from "react";
import { Rocket, Play, Square, RefreshCw, Trash2, Loader2, Check } from "lucide-react";
import type { ComposeService } from "@/lib/dokploy";
import { composeLifecycleAction, saveComposeFileAction } from "@/app/actions";

function useComposeLifecycle(c: ComposeService) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: "deploy" | "start" | "stop" | "remove", after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await composeLifecycleAction(c.id, action);
      if (!res.ok) setError(res.error);
      else after?.();
    });
  };
  return { pending, error, run };
}

export function ComposeOverviewTab({ compose }: { compose: ComposeService }) {
  const { pending, error, run } = useComposeLifecycle(compose);
  const running = compose.status === "done";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {compose.status === "idle" ? (
          <Btn onClick={() => run("deploy")} disabled={pending} primary>
            <Rocket className="size-3.5" /> Deploy
          </Btn>
        ) : running ? (
          <Btn onClick={() => run("stop")} disabled={pending}>
            <Square className="size-3.5" /> Stop
          </Btn>
        ) : (
          <Btn onClick={() => run("start")} disabled={pending}>
            <Play className="size-3.5" /> Start
          </Btn>
        )}
        {compose.status !== "idle" && (
          <Btn onClick={() => run("deploy")} disabled={pending}>
            <RefreshCw className="size-3.5" /> Redeploy
          </Btn>
        )}
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      <p className="text-xs text-[var(--color-fg-muted)]">
        A raw <code className="font-mono">docker-compose</code> stack. Edit the file in the Compose
        tab, then deploy.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Info label="Type" value={compose.composeType ?? "docker-compose"} />
        <Info label="App name" value={compose.appName} mono />
      </div>
    </div>
  );
}

export function ComposeEditorTab({ compose }: { compose: ComposeService }) {
  const [value, setValue] = useState(compose.composeFile ?? "");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== (compose.composeFile ?? "");

  function save(redeploy: boolean) {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await saveComposeFileAction(compose.id, value, redeploy);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } else setError(res.error);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-xs text-[var(--color-fg-muted)]">docker-compose.yml</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        className="min-h-72 flex-1 resize-none rounded-lg border border-[var(--color-border-strong)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
        {saved && (
          <span className="flex items-center gap-1 text-xs text-[var(--color-ok)]">
            <Check className="size-3.5" /> Saved
          </span>
        )}
        <button
          onClick={() => save(false)}
          disabled={pending || !dirty}
          className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          Save
        </button>
        <button
          onClick={() => save(true)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save &amp; deploy
        </button>
      </div>
    </div>
  );
}

export function ComposeSettingsTab({
  compose,
  onClose,
}: {
  compose: ComposeService;
  onClose: () => void;
}) {
  const { pending, error, run } = useComposeLifecycle(compose);
  return (
    <div className="space-y-5">
      <Info label="App name" value={compose.appName} mono />
      <Info
        label="Created"
        value={compose.createdAt ? new Date(compose.createdAt).toLocaleString() : "—"}
      />
      <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] p-4">
        <h3 className="text-sm font-semibold text-[var(--color-danger)]">Danger zone</h3>
        <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
          Destroying removes the stack and all its containers. This cannot be undone.
        </p>
        <button
          onClick={() => {
            if (confirm(`Destroy "${compose.name}"? This cannot be undone.`)) run("remove", onClose);
          }}
          disabled={pending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-danger)]/50 px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-50"
        >
          <Trash2 className="size-3.5" /> Destroy {compose.name}
        </button>
        {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
      </div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 " +
        (primary
          ? "bg-[var(--color-brand-strong)] text-white hover:bg-[var(--color-brand)]"
          : "border border-[var(--color-border-strong)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]")
      }
    >
      {children}
    </button>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-xs text-[var(--color-fg-subtle)]">{label}</div>
      <div className={"mt-0.5 truncate text-sm " + (mono ? "font-mono text-xs" : "")} title={value}>
        {value}
      </div>
    </div>
  );
}
