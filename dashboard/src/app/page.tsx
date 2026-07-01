import { loadWorkspace, inferEdges } from "@/lib/dokploy";
import { Workspace } from "@/components/Workspace";

// Always fetch fresh state from Dokploy.
export const dynamic = "force-dynamic";

export default async function Page() {
  let result: Awaited<ReturnType<typeof loadWorkspace>> | null = null;
  let message: string | null = null;
  try {
    result = await loadWorkspace();
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }

  if (result) {
    return (
      <Workspace
        services={result.services}
        projects={result.projects}
        edges={inferEdges(result.services)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <div className="rounded-2xl border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] p-6">
        <h1 className="text-lg font-semibold text-[var(--color-danger)]">
          Couldn&apos;t reach Dokploy
        </h1>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
          The dashboard couldn&apos;t talk to the Dokploy API. Check that Dokploy is running and that{" "}
          <code className="font-mono">DOKPLOY_URL</code>, <code className="font-mono">DOKPLOY_EMAIL</code>{" "}
          and <code className="font-mono">DOKPLOY_PASSWORD</code> in{" "}
          <code className="font-mono">.env.local</code> are correct.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-[var(--color-bg-elevated)] p-3 font-mono text-xs text-[var(--color-fg-muted)]">
          {message}
        </pre>
      </div>
    </div>
  );
}
