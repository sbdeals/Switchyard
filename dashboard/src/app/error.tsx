"use client";

import { ErrorPanel } from "@/components/ErrorPanel";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorPanel reference={error.digest}>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-[var(--color-brand-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-deep)]"
      >
        Retry
      </button>
    </ErrorPanel>
  );
}
