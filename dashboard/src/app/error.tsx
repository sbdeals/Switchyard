"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <div role="alert" className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-8">
        <TriangleAlert aria-hidden="true" className="mb-4 size-8 text-[var(--color-warn)]" />
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
          We couldn&apos;t load this page. Try again, or head back to your projects.
        </p>
        {error.digest && (
          <p className="mt-4 break-all text-xs text-[var(--color-fg-subtle)]">
            Error reference: <code>{error.digest}</code>
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-[var(--color-brand-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-deep)]"
          >
            Retry
          </button>
          <Link href="/" className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface)]">
            Back to projects
          </Link>
        </div>
      </div>
    </main>
  );
}
