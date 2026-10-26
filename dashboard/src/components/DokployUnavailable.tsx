"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Unplug } from "lucide-react";

export function DokployUnavailable() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <div role="alert" className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-8">
        <Unplug aria-hidden="true" className="mb-4 size-8 text-[var(--color-warn)]" />
        <h1 className="text-xl font-semibold tracking-tight">Can&apos;t reach Dokploy</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
          We couldn&apos;t connect to Dokploy. Check that it&apos;s running and reachable, then try again.
        </p>
        <p className="mt-3 text-sm text-[var(--color-fg-muted)]">
          Check that <code>DOKPLOY_URL</code>, <code>DOKPLOY_EMAIL</code> and{" "}
          <code>DOKPLOY_PASSWORD</code> are correct. Set them with <code>switchyard config</code>{" "}
          for the managed container, or in <code>.env.local</code> when running from source.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          {pending ? "Retrying…" : "Retry"}
        </button>
      </div>
    </main>
  );
}
