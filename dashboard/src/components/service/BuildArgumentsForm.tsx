"use client";

import { useState, useTransition } from "react";
import type { Application } from "@/lib/dokploy";
import { parseBuildArgs, reviewBuildArgs, secretBuildArgKeys } from "@/lib/build-args";
import { saveApplicationBuildArgsAction } from "@/app/actions";
import { SaveRow, useSavedFlash } from "@/components/service/primitives";

export function BuildArgumentsForm({ app }: { app: Application }) {
  const [value, setValue] = useState(app.buildArgs ?? "");
  const [savedValue, setSavedValue] = useState(app.buildArgs ?? "");
  const [reviewing, setReviewing] = useState(false);
  const [saving, startSave] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== savedValue;
  const { entries, errors } = parseBuildArgs(value);
  const secretKeys = secretBuildArgKeys(entries);
  const changes = reviewBuildArgs(savedValue, value);

  function save() {
    setError(null);
    startSave(async () => {
      const res = await saveApplicationBuildArgsAction(app.id, value);
      if (res.ok) {
        setSavedValue(value);
        setReviewing(false);
        flashSaved();
      } else setError(res.error);
    });
  }

  return (
    <section aria-label="Build arguments" className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--color-fg)]">Build arguments</h3>
      <p className="text-xs text-[var(--color-fg-muted)]">
        One <code className="font-mono">KEY=value</code> per line. Applies on next deploy.
        Saving does not deploy your application.
      </p>
      <p className="text-xs text-[var(--color-fg-muted)]">
        Build args are visible in image history (<code className="font-mono">docker history</code>).
        {app.buildSecretsSupported
          ? " Put secrets in Dokploy build secrets, or runtime variables if only needed at runtime."
          : " Keep secrets in runtime variables, not build arguments."}
      </p>
      {secretKeys.length > 0 && (
        <p role="status" className="text-xs text-[var(--color-warn)]">
          These keys look like secrets: {secretKeys.join(", ")}. You can still save, but their
          values may be exposed in the image.
        </p>
      )}
      {reviewing ? (
        <div aria-label="Review build arguments" className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <h4 className="text-xs font-semibold text-[var(--color-fg)]">Review changes</h4>
          <p className="text-xs text-[var(--color-fg-muted)]">All values are masked.</p>
          {changes.length ? (
            <ul className="space-y-1 font-mono text-xs text-[var(--color-fg)]">
              {changes.map(({ key, change }) => (
                <li key={key}>{key}=•••••••• <span className="text-[var(--color-fg-muted)]">({change})</span></li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--color-fg-muted)]">Only formatting or comments changed.</p>
          )}
        </div>
      ) : (
        <textarea
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          spellCheck={false}
          autoComplete="off"
          placeholder={"GREETING=Hello from the build\nPUBLIC_API_URL=https://example.com"}
          aria-label="Build arguments, one KEY=value per line"
          aria-invalid={errors.length > 0}
          className="min-h-40 w-full resize-y rounded-lg border border-[var(--color-border-control)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
        />
      )}
      {errors.length > 0 && <p role="alert" className="text-xs text-[var(--color-danger)]">{errors.join(" ")}</p>}
      <div className="flex items-center justify-between gap-3">
        {reviewing ? (
          <button type="button" disabled={saving} onClick={() => setReviewing(false)} className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            Back to editing
          </button>
        ) : (
          <span className="text-xs text-[var(--color-fg-subtle)]">
            {dirty ? "Unsaved changes" : `${entries.length} build argument${entries.length === 1 ? "" : "s"}`}
          </span>
        )}
        <SaveRow
          saving={saving}
          saved={saved && !dirty}
          error={error}
          disabled={!dirty || errors.length > 0}
          onSave={reviewing ? save : () => setReviewing(true)}
          label={reviewing ? "Save build arguments" : "Review changes"}
        />
      </div>
    </section>
  );
}
