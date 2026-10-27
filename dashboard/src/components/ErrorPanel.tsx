import type { ReactNode } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { ErrorDetails } from "@/components/ErrorDetails";

export function ErrorPanel({
  reference,
  scrubbedDetails,
  children,
}: {
  reference?: string;
  scrubbedDetails?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <div role="alert" className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-8">
        <TriangleAlert aria-hidden="true" className="mb-4 size-8 text-[var(--color-warn)]" />
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
          We couldn&apos;t load this page. Try again, or head back to your projects.
        </p>
        {reference && (
          <p className="mt-4 break-all text-xs text-[var(--color-fg-subtle)]">
            Error reference: <code>{reference}</code>
          </p>
        )}
        {scrubbedDetails && <ErrorDetails scrubbedDetails={scrubbedDetails} />}
        <div className="mt-6 flex flex-wrap gap-3">
          {children}
          <Link href="/" className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface)]">
            Back to projects
          </Link>
        </div>
      </div>
    </main>
  );
}
