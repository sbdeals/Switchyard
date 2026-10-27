"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ChevronDown, Loader2, Rocket } from "lucide-react";
import type { Application } from "@/lib/dokploy";
import { appLifecycleAction } from "@/lib/client-actions";
import { deployOptionsAction } from "@/app/deploy-actions";
import { useDialogFocus } from "@/components/use-focus-trap";
import {
  DEPLOY_DESCRIPTION_MAX_LENGTH,
  DEPLOY_TITLE_MAX_LENGTH,
  getDeployOptionsState,
  type DeployOptionsRequest,
} from "@/lib/deploy-options";
import { Btn, Field, inputCls, LifecycleButtons, useLifecycle } from "./primitives";

export function AppDeployControls({ app }: { app: Application }) {
  const lifecycle = useLifecycle((action) => appLifecycleAction(app.id, action));
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const menuRef = useDialogFocus<HTMLDivElement>(() => setOpen(false));
  const busy = pending || lifecycle.pending;
  const state = getDeployOptionsState({ pending: busy, status: app.status, sourceType: app.sourceType });

  function submit(input: DeployOptionsRequest) {
    setOpen(false);
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const result = await deployOptionsAction(app.id, input);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (input.kind === "clean-cache") {
          setNotice(`Clean cache on build ${input.enabled ? "enabled" : "disabled"}. Saved for future builds. Click Redeploy when ready.`);
        } else {
          setMessageOpen(false);
          setTitle("");
          setDescription("");
          setNotice("Deployment queued. See Deploys for progress.");
        }
      } catch {
        setError("Could not apply deployment option. Please try again.");
      }
    });
  }

  function changeCache() {
    if (!app.cleanCache && !confirm(
      "Clean cache on every build? Builds will be slower. This setting stays enabled until you turn it off. Saving does not deploy."
    )) return;
    submit({ kind: "clean-cache", enabled: !app.cleanCache });
  }

  const optionCls = "block w-full rounded-md px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:opacity-40";

  return (
    <div className="space-y-3">
      <LifecycleButtons
        status={app.status}
        runtime={app.runtime}
        pending={busy}
        error={error ?? lifecycle.error}
        run={lifecycle.run}
        deployControl={
          <div
            className="relative inline-flex"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
          >
            <button
              type="button"
              disabled={state.deployDisabled}
              onClick={() => submit({ kind: "deploy" })}
              className="inline-flex items-center gap-1.5 rounded-l-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
              {app.status === "idle" ? "Deploy" : "Redeploy"}
            </button>
            <button
              ref={trigger}
              type="button"
              aria-label="Deployment options"
              aria-expanded={open}
              aria-controls={panelId}
              disabled={busy}
              onClick={() => setOpen(!open)}
              className="rounded-r-lg border-l border-white/20 bg-[var(--color-brand-strong)] px-2 text-white hover:bg-[var(--color-brand-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:opacity-40"
            >
              <ChevronDown className="size-3.5" />
            </button>
            {open && (
              <div ref={menuRef} id={panelId} role="dialog" aria-label="Deployment options" className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-lg">
                <button data-autofocus type="button" disabled={state.redeployDisabled} className={optionCls} onClick={() => submit({ kind: "redeploy" })}>
                  Redeploy
                  <span className="mt-0.5 block text-[10px] text-[var(--color-fg-subtle)]">{app.status === "idle" ? "Deploy once before rebuilding." : "Rebuild the current checkout."}</span>
                </button>
                <button type="button" disabled={state.cacheDisabled} aria-pressed={app.cleanCache} className={optionCls} onClick={changeCache}>
                  Clean cache on build: {app.cleanCache ? "On" : "Off"}
                  <span className="mt-0.5 block text-[10px] text-[var(--color-fg-subtle)]">
                    {app.sourceType === "docker" ? "Image sources have no build cache." : "Persistent setting · saving does not deploy."}
                  </span>
                </button>
                <button type="button" disabled={state.redeployDisabled} className={optionCls} onClick={() => { setMessageOpen(true); setOpen(false); setNotice(null); }}>
                  Deploy with message
                </button>
              </div>
            )}
          </div>
        }
      />
      {app.cleanCache && (
        <p className="text-xs text-[var(--color-fg-muted)]">Clean cache on build is on. Every build skips its cache until you turn this off.</p>
      )}
      {notice && <p role="status" className="text-xs text-[var(--color-fg-muted)]">{notice}</p>}
      {messageOpen && (
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
          <p className="text-xs text-[var(--color-fg-muted)]">Rebuild the current checkout with a message in Deploys history.</p>
          <Field label="Deployment title">
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={DEPLOY_TITLE_MAX_LENGTH} disabled={busy} className={inputCls} />
          </Field>
          <Field label="Description" hint="optional">
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={DEPLOY_DESCRIPTION_MAX_LENGTH} disabled={busy} rows={3} className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn disabled={busy} onClick={() => { setMessageOpen(false); trigger.current?.focus(); }}>Cancel</Btn>
            <Btn primary disabled={state.redeployDisabled || !title.trim()} onClick={() => submit({ kind: "message", title, description })}>Deploy with message</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
