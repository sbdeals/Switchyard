"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { ImageUpdateResult } from "@/lib/image-update";
import { apiFetch } from "@/lib/api-client";

const STATUS = {
  "up-to-date": { label: "Up to date", color: "var(--color-ok)", background: "var(--color-ok-soft)" },
  "update-available": { label: "Update available", color: "var(--color-warn)", background: "var(--color-warn-soft)" },
  unknown: { label: "Unknown", color: "var(--color-idle)", background: "var(--color-idle-soft)" },
};

export function ImageUpdateDetails({ result, compose = false }: { result: ImageUpdateResult; compose?: boolean }) {
  const status = STATUS[result.status];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--color-fg-muted)]">{result.serviceName ?? "Image status"}</span>
        <span
          className="rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ color: status.color, backgroundColor: status.background }}
        >
          {status.label}
        </span>
      </div>
      <dl className="space-y-2 text-xs">
        {[
          [compose ? "Container image" : "Configured image", result.image || "Not configured"],
          ["Running image digest", result.runningDigest ?? "Unavailable"],
          ["Registry digest (same tag)", result.registryDigest ?? "Unavailable"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[var(--color-fg-subtle)]">{label}</dt>
            <dd className="mt-0.5 break-all font-mono text-[var(--color-fg)]">{value}</dd>
          </div>
        ))}
      </dl>
      {result.reason && <p className="text-xs text-[var(--color-fg-muted)]">{result.reason}</p>}
      {result.checkedAt && (
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Registry checked <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleString()}</time>
        </p>
      )}
    </div>
  );
}

export function ImageUpdatePanel({ kind, id, image }: {
  kind: "application" | "database" | "compose";
  id: string;
  image: string | null;
}) {
  const [images, setImages] = useState<ImageUpdateResult[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setPending(true);
    setError(null);
    try {
      const query = new URLSearchParams({ kind, id });
      const response = await apiFetch(`/api/services/image-update?${query}`, { cache: "no-store" });
      const data = await response.json() as { images: ImageUpdateResult[] };
      setImages(data.images);
    } catch (error) {
      setImages(null);
      setError(error instanceof Error ? error.message : "Image check unavailable. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const results = images ?? [{
    image: image ?? "",
    runningDigest: null,
    registryDigest: null,
    status: "unknown" as const,
    reason: "Check now to compare the running image with its public registry tag.",
    checkedAt: null,
  }];

  return (
    <section aria-label="Image updates" className="mt-5 space-y-4 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Image updates</h3>
        <button
          type="button"
          onClick={check}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {pending ? "Checking…" : "Check now"}
        </button>
      </div>
      <div aria-live="polite" aria-busy={pending} className="space-y-5">
        {kind === "compose" && images === null ? (
          <p className="text-xs text-[var(--color-fg-muted)]">Check the images used by this stack’s running containers.</p>
        ) : results.map((result, index) => (
          <ImageUpdateDetails key={`${result.serviceName ?? ""}:${result.image}:${index}`} result={result} compose={kind === "compose"} />
        ))}
        {images?.length === 0 && <p className="text-xs text-[var(--color-fg-muted)]">No running container images found.</p>}
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        Manual checks only. Public Docker Hub and GHCR results are cached for 10 minutes. Checks never redeploy services.
      </p>
    </section>
  );
}
