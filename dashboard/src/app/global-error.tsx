"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0f", color: "#ededf2", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 480, margin: "96px auto", padding: 24 }}>
          <h1>Something went wrong</h1>
          <p>Switchyard couldn&apos;t load. Please try again.</p>
          {error.digest && <p style={{ overflowWrap: "anywhere" }}>Error reference: <code>{error.digest}</code></p>}
          <button type="button" onClick={() => reset()}>Retry</button>
          {" "}
          {/* A full navigation can recover even when the root layout failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={{ color: "#a06bff" }}>Back to projects</a>
        </main>
      </body>
    </html>
  );
}
