/** Only pass details scrubbed by redactErrorMessage on the server. */
export function ErrorDetails({ scrubbedDetails }: { scrubbedDetails: string }) {
  return (
    <details className="mt-4 text-sm text-[var(--color-fg-muted)]">
      <summary className="cursor-pointer">Show details</summary>
      <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{scrubbedDetails}</pre>
    </details>
  );
}
