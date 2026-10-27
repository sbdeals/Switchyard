import Link from "next/link";
import { Boxes } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <div className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-8">
        <Boxes aria-hidden="true" className="mb-4 size-8 text-[var(--color-brand)]" />
        <p className="text-sm font-medium text-[var(--color-brand)]">404</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
          This page doesn&apos;t exist. Head back to your projects to keep going.
        </p>
        <Link href="/" className="mt-6 inline-flex rounded-lg bg-[var(--color-brand-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-deep)]">
          Back to projects
        </Link>
      </div>
    </main>
  );
}
