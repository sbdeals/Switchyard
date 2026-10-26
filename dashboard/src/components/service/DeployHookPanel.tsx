"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { deletePreviewAction, getDeployHookAction, updateDeployHookAction, updatePreviewSettingsAction, type DeployHookView } from "@/app/deploy-hook-actions";
import { Btn, CopyButton, Field, inputCls } from "@/components/service/primitives";

type DeployHook = Pick<DeployHookView, "enabled" | "path" | "secret"> & Partial<DeployHookView>;

export function DeployHookPanel({ serviceId, branch }: { serviceId: string; branch: string }) {
  const [hook, setHook] = useState<DeployHook | null>(null);
  const [origin, setOrigin] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let current = true;
    const refresh = () => getDeployHookAction(serviceId).then((result) => {
      if (!current) return;
      setOrigin(window.location.origin);
      if (result.ok) setHook(result.hook);
      else setError(result.error);
    }).catch(() => {
      if (current) setError("Could not load deploy-on-push settings.");
    }).finally(() => {
      if (current) setLoading(false);
    });
    void refresh();
    const timer = setInterval(refresh, 10_000);
    return () => { current = false; clearInterval(timer); };
  }, [serviceId]);

  function update(operation: "enable" | "disable" | "regenerate") {
    setError(null);
    start(async () => {
      try {
        const result = await updateDeployHookAction(serviceId, operation);
        if (result.ok) setHook(result.hook);
        else setError(result.error);
      } catch {
        setError("Could not update deploy-on-push settings.");
      }
    });
  }

  function previews(enabled: boolean, allowForks: boolean) {
    setError(null);
    start(async () => {
      const result = await updatePreviewSettingsAction(serviceId, { enabled, allowForks });
      if (result.ok) setHook(result.hook);
      else setError(result.error);
    });
  }

  function deletePreview(number: number) {
    setError(null);
    start(async () => {
      const result = await deletePreviewAction(serviceId, number);
      if (result.ok) setHook(result.hook);
      else setError(result.error);
    });
  }

  return (
    <section aria-label="Deploy on push" className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Deploy on push</h3>
          <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
            Automatically deploy pushes to <code className="font-mono">{branch}</code>.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Deploy on push"
          aria-checked={hook?.enabled ?? false}
          disabled={loading || pending}
          onClick={() => update(hook?.enabled ? "disable" : "enable")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          {(loading || pending) && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
          {hook?.enabled ? "Disable" : "Enable"}
        </button>
      </div>
      {loading && <p role="status" className="text-xs text-[var(--color-fg-subtle)]">Loading webhook settings…</p>}
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
      {hook && (
        <>
          {!hook.enabled && <p role="status" className="text-xs text-[var(--color-fg-muted)]">Disabled. Webhook deliveries will not deploy this service.</p>}
          <DeployHookInstructions hook={hook} origin={origin} />
          <PreviewSettings hook={hook} pending={pending} onChange={previews} onDelete={deletePreview} />
          <div className="flex items-center gap-3">
            <Btn disabled={pending} onClick={() => update("regenerate")}>Regenerate</Btn>
            <p className="text-[11px] text-[var(--color-fg-subtle)]">
              Replaces the URL and secret. Update both in GitHub afterward.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

export function PreviewSettings({ hook, pending, onChange, onDelete }: {
  hook: DeployHook; pending: boolean;
  onChange: (enabled: boolean, allowForks: boolean) => void;
  onDelete: (number: number) => void;
}) {
  return (
    <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
      <label className="flex items-center justify-between text-sm">
        PR previews
        <input type="checkbox" role="switch" aria-label="PR previews" checked={hook.previewsEnabled ?? false}
          disabled={pending || !hook.enabled} onChange={(event) => onChange(event.target.checked, hook.allowForks ?? false)} />
      </label>
      <p className="text-xs text-[var(--color-fg-muted)]">
        Up to 5 previews, each with its own URL. Vault references are omitted; ordinary parent variables are copied and have no secret/sealed flag.
        Uses an existing preview environment, otherwise this service&apos;s environment.
        Enabling creates an encrypted automation API key with your Dokploy permissions, used to manage these previews after sign-out.
        Turning previews off stops new deployments; close events still clean up existing previews while the hook is enabled.
      </p>
      <label className="flex items-center justify-between gap-3 text-xs">
        Allow fork PR previews (fork code receives the parent&apos;s env)
        <input type="checkbox" role="switch" aria-label="Allow fork PR previews" checked={hook.allowForks ?? false}
          disabled={pending || !hook.previewsEnabled} onChange={(event) => onChange(hook.previewsEnabled ?? false, event.target.checked)} />
      </label>
      <div aria-label="Active PR previews" className="space-y-2">
        {(hook.previews ?? []).length === 0 && <p className="text-xs text-[var(--color-fg-subtle)]">No active previews.</p>}
        {(hook.previews ?? []).map((preview) => (
          <div key={preview.number} className="space-y-1 rounded border border-[var(--color-border)] p-2 text-xs">
            <p title={preview.title}>PR #{preview.number} · {preview.branch}{preview.deleting ? " · Cleanup pending" : ""}</p>
            {preview.url && <a href={preview.url} target="_blank" rel="noreferrer" className="block text-[var(--color-brand)] hover:underline">{preview.url}</a>}
            <Btn disabled={pending} onClick={() => onDelete(preview.number)}>Delete preview</Btn>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DeployHookInstructions({ hook, origin }: { hook: DeployHook; origin: string }) {
  const [revealed, setRevealed] = useState(false);
  const url = `${origin}${hook.path}`;
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
        In your GitHub repository, open <strong>Settings → Webhooks → Add webhook</strong>.
      </p>
      <Field label="Payload URL">
        <div className="flex items-center gap-2">
          <input className={`${inputCls} font-mono text-xs`} value={url} readOnly />
          <CopyButton text={url} />
        </div>
      </Field>
      <p className="text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
        GitHub needs an externally reachable dashboard URL. Replace the origin above if you access this dashboard locally.
      </p>
      <Field label="Secret">
        <div className="flex items-center gap-2">
          <input
            className={`${inputCls} font-mono text-xs`}
            type={revealed ? "text" : "password"}
            value={hook.secret}
            readOnly
            autoComplete="off"
          />
          <button
            type="button"
            aria-pressed={revealed}
            aria-label={revealed ? "Hide webhook secret" : "Show webhook secret"}
            onClick={() => setRevealed(!revealed)}
            className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            {revealed ? "Hide" : "Show"}
          </button>
          <CopyButton text={hook.secret} />
        </div>
      </Field>
      <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
        Set <strong>Content type</strong> to <code className="font-mono">application/json</code>,
        select <strong>{hook.previewsEnabled ? "Let me select individual events: Pushes and Pull requests" : "Just the push event"}</strong>, keep <strong>Active</strong> checked,
        then click <strong>Add webhook</strong>.
      </p>
      <p className="text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
        This hook keeps working when you sign out. Disable or regenerate it to revoke its deployment token.
      </p>
    </div>
  );
}
