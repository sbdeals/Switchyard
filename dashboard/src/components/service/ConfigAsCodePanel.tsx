"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { Application } from "@/lib/dokploy";
import { dashboardConfig, resolveConfig, type ParsedConfig } from "@/lib/config-as-code";
import { fetchPublicRepoConfig } from "@/lib/config-as-code-fetch";
import { Field, inputCls } from "@/components/service/primitives";

/** Read-only until Dokploy's clone/deploy path can apply the complete schema. */
export function ConfigAsCodePanel({ app }: { app: Application }) {
  const [repoUrl, setRepoUrl] = useState(
    app.gitUrl ?? (app.sourceType === "github" && app.repository
      ? `https://github.com/${app.repository}` : "")
  );
  const [branch, setBranch] = useState(app.branch ?? "main");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParsedConfig | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function clearPreview() {
    setResult(null);
    setMessage(null);
    setError(null);
  }

  async function preview() {
    clearPreview();
    setLoading(true);
    try {
      const parsed = await fetchPublicRepoConfig(repoUrl.trim(), branch.trim());
      setResult(parsed);
      if (!parsed) setMessage("No switchyard.json, railway.json, or railway.toml found at this repository root and branch.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read repository config.");
    } finally {
      setLoading(false);
    }
  }

  const resolved = result && result.errors.length === 0
    ? resolveConfig(dashboardConfig(app), result) : null;

  return (
    <section aria-label="Config as code" className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
      <h3 className="text-sm font-semibold">Config as code</h3>
      <p className="text-xs text-[var(--color-fg-muted)]">
        Preview a public GitHub repository’s root config. File values override saved dashboard
        settings in this preview. Applying config during deployment is not yet supported.
      </p>
      <Field label="Public GitHub repository">
        <input
          aria-label="Config repository URL"
          value={repoUrl}
          disabled={loading}
          onChange={(e) => { setRepoUrl(e.target.value); clearPreview(); }}
          placeholder="https://github.com/owner/repo"
          className={inputCls}
        />
      </Field>
      <Field label="Branch or commit">
        <input
          aria-label="Config branch or commit"
          value={branch}
          disabled={loading}
          onChange={(e) => { setBranch(e.target.value); clearPreview(); }}
          className={inputCls}
        />
      </Field>
      <button
        onClick={preview}
        disabled={loading || !repoUrl.trim() || !branch.trim()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium hover:bg-[var(--color-surface)] disabled:opacity-40"
      >
        {loading && <Loader2 className="size-3.5 animate-spin" />}
        {loading ? "Reading config…" : "Preview config"}
      </button>
      {message && <p role="status" className="text-xs text-[var(--color-fg-muted)]">{message}</p>}
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
      {result && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-xs font-medium">Read from {result.file}</p>
          {result.errors.map((item, i) => (
            <p key={i} role="alert" className="text-xs text-[var(--color-danger)]">{item}</p>
          ))}
          {result.warnings.map((item, i) => (
            <p key={i} className="text-xs text-[var(--color-fg-muted)]">Warning: {item}</p>
          ))}
          {resolved && (
            <dl className="space-y-2 text-xs">
              {Object.entries(resolved.config).flatMap(([section, values]) =>
                Object.entries(values).map(([key, value]) => {
                  const path = `${section}.${key}`;
                  return (
                    <div key={path} className="rounded-md bg-[var(--color-surface)] p-2">
                      <dt className="flex flex-wrap justify-between gap-1 text-[var(--color-fg-muted)]">
                        <span>{path}</span>
                        <span className="font-medium">From {resolved.sources[path]}</span>
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap break-all font-mono">
                        {typeof value === "string" ? value || '""' : JSON.stringify(value)}
                      </dd>
                    </div>
                  );
                })
              )}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
