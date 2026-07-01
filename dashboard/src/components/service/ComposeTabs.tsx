"use client";

import { useState, useTransition } from "react";
import type { ComposeService } from "@/lib/dokploy";
import { composeLifecycleAction, saveComposeFileAction } from "@/app/actions";
import {
  Info,
  LifecycleButtons,
  SaveRow,
  DangerZone,
  useLifecycle,
  useSavedFlash,
} from "@/components/service/primitives";

const useComposeLifecycle = (c: ComposeService) =>
  useLifecycle((action) => composeLifecycleAction(c.id, action));

export function ComposeOverviewTab({ compose }: { compose: ComposeService }) {
  const { pending, error, run } = useComposeLifecycle(compose);
  return (
    <div className="space-y-5">
      <LifecycleButtons status={compose.status} pending={pending} error={error} run={run} />
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
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== (compose.composeFile ?? "");

  function save(redeploy: boolean) {
    setError(null);
    start(async () => {
      const res = await saveComposeFileAction(compose.id, value, redeploy);
      if (res.ok) flashSaved();
      else setError(res.error);
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
        <button
          onClick={() => save(false)}
          disabled={pending || !dirty}
          className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          Save
        </button>
        <SaveRow saving={pending} saved={saved} error={error} onSave={() => save(true)} label="Save & deploy" />
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
      <DangerZone
        name={compose.name}
        message="Destroying removes the stack and all its containers."
        pending={pending}
        error={error}
        onDestroy={() => run("remove", onClose)}
      />
    </div>
  );
}
