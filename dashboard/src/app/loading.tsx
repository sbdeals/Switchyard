export default function Loading() {
  return (
    <main role="status" aria-label="Loading services" className="mx-auto max-w-7xl px-6 py-8">
      <span className="sr-only">Loading services…</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="h-8 w-36 rounded-lg bg-[var(--color-surface)]" />
            <div className="mt-2 h-4 w-64 rounded bg-[var(--color-surface)]" />
          </div>
          <div className="h-9 w-64 rounded-lg bg-[var(--color-surface)]" />
        </div>
        <div className="grid min-h-[60vh] content-start gap-4 rounded-2xl border border-[var(--color-border)] p-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-24 rounded-xl bg-[var(--color-surface)]" />
          ))}
        </div>
      </div>
    </main>
  );
}
