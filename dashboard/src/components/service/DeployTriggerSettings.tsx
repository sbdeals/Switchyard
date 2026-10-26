"use client";

import { useEffect, useState, useTransition } from "react";
import type { Application, ComposeService } from "@/lib/dokploy";
import {
  previewDeployTriggersAction,
  updateDeployTriggersAction,
} from "@/app/deploy-trigger-actions";
import { MAX_WATCH_PATHS_LENGTH, parseDeployTriggers } from "@/lib/deploy-triggers";
import { Field, Info, inputCls, SaveRow, useSavedFlash } from "./primitives";

export function DeployTriggerSettings({ service }: { service: Application | ComposeService }) {
  const initialAutoDeploy = service.autoDeploy;
  const isTagTrigger = service.triggerType === "tag";
  const autoDeployLabel = isTagTrigger ? "Auto-deploy on tag" : "Auto-deploy on push";
  const [autoDeploy, setAutoDeploy] = useState(initialAutoDeploy);
  const [watchPaths, setWatchPaths] = useState(service.watchPaths.join("\n"));
  const [examples, setExamples] = useState("src/index.ts\nsrc/index.test.ts\nREADME.md\npackage.json");
  const [saving, start] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    key: string;
    result: Awaited<ReturnType<typeof previewDeployTriggersAction>>;
  } | null>(null);
  const previewKey = JSON.stringify([autoDeploy, watchPaths, examples]);

  let validationError: string | null = null;
  let normalizedPaths: string[] = [];
  try {
    normalizedPaths = parseDeployTriggers({ autoDeploy, watchPaths }).watchPaths;
  } catch (e) {
    validationError = e instanceof Error ? e.message : "Invalid watch paths.";
  }
  const dirty = autoDeploy !== initialAutoDeploy || normalizedPaths.join("\n") !== service.watchPaths.join("\n");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await previewDeployTriggersAction(
          { autoDeploy, watchPaths },
          examples.split(/\r?\n/).map((path) => path.trim()).filter(Boolean)
        );
        if (!cancelled) setPreview({ key: previewKey, result });
      } catch {
        if (!cancelled) setPreview({ key: previewKey, result: { ok: false, error: "Preview unavailable. Try again." } });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [autoDeploy, watchPaths, examples, previewKey]);

  function save() {
    setError(null);
    start(async () => {
      const result = await updateDeployTriggersAction(service.kind, service.id, { autoDeploy, watchPaths });
      if (result.ok) flashSaved();
      else setError(result.error);
    });
  }

  const currentPreview = preview?.key === previewKey ? preview.result : null;

  return (
    <section aria-label="Deploy triggers" className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="text-sm font-semibold">Deploy triggers</h3>
      <Info label="Trigger type" value={isTagTrigger ? "Tag" : "Push"} />
      <button
        type="button"
        role="switch"
        aria-label={autoDeployLabel}
        aria-checked={autoDeploy}
        disabled={saving}
        onClick={() => setAutoDeploy((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--color-border-control)] px-3 py-2 text-xs font-medium disabled:opacity-40"
      >
        <span>{autoDeployLabel}</span>
        <span className={autoDeploy ? "text-[var(--color-brand)]" : "text-[var(--color-fg-subtle)]"}>
          {autoDeploy ? "Enabled" : "Disabled"}
        </span>
      </button>
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        {isTagTrigger
          ? "Deploy when the connected Git source sends a matching tag. Tag deployments do not use watch paths; the preview below only checks path patterns."
          : "Deploy when the connected Git source sends a push for the configured branch."}
      </p>
      <Field label="Watch paths" hint="one glob per line · blank = any change">
        <textarea
          value={watchPaths}
          onChange={(e) => setWatchPaths(e.target.value)}
          disabled={saving}
          maxLength={MAX_WATCH_PATHS_LENGTH}
          placeholder={"src/**\n!**/*.test.ts\npackage.json"}
          rows={3}
          className={`${inputCls} resize-y font-mono`}
        />
      </Field>
      <p className="text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
        Paths are relative to the repository root. Use ** for nested folders and ! to exclude;
        later patterns can include a path again. Matching is case-sensitive. Wildcards skip dotfiles
        unless explicitly matched. Up to 100 patterns, 512 characters each.
      </p>
      <Field label="Example paths" hint="preview only · one file per line">
        <textarea
          value={examples}
          onChange={(e) => setExamples(e.target.value)}
          maxLength={10260}
          rows={3}
          className={`${inputCls} resize-y font-mono`}
        />
      </Field>
      <div aria-live="polite" className="space-y-1 text-[11px]">
        {!currentPreview ? (
          <p className="text-[var(--color-fg-subtle)]">Checking example paths…</p>
        ) : !currentPreview.ok ? (
          <p className="text-[var(--color-danger)]">{currentPreview.error}</p>
        ) : currentPreview.preview.map(({ path, matches, triggers }, index) => (
          <div key={`${index}:${path}`} className="flex items-center justify-between gap-3">
            <code className="truncate">{path}</code>
            <span className={(isTagTrigger ? matches : triggers) ? "shrink-0 text-[var(--color-ok)]" : "shrink-0 text-[var(--color-fg-subtle)]"}>
              {isTagTrigger ? (matches ? "Matches pattern" : "No match") : triggers ? "Will trigger" : matches ? "Auto-deploy off" : "Ignored"}
            </span>
          </div>
        ))}
      </div>
      <SaveRow
        saving={saving}
        saved={saved}
        error={validationError ?? error}
        disabled={!dirty || !!validationError}
        onSave={save}
        label="Save deploy triggers"
      />
    </section>
  );
}
