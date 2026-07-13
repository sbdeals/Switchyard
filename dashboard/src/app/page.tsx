import { unstable_rethrow } from "next/navigation";

import { loadWorkspace, inferEdges } from "@/lib/dokploy";
import { Workspace } from "@/components/Workspace";
import { LogoutButton } from "@/components/LogoutButton";

// Always fetch fresh state from Dokploy.
export const dynamic = "force-dynamic";

export default async function Page() {
  let result: Awaited<ReturnType<typeof loadWorkspace>> | null = null;
  let message: string | null = null;
  try {
    result = await loadWorkspace();
  } catch (e) {
    // Let framework control-flow errors (e.g. redirect to /login on an expired
    // session) propagate instead of rendering them as an error panel.
    unstable_rethrow(e);
    message = e instanceof Error ? e.message : String(e);
  }

  if (result) {
    return (
      <>
        <LogoutButton />
        <Workspace
          services={result.services}
          projects={result.projects}
          edges={inferEdges(result.services)}
        />
      </>
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
          and <code className="font-mono">DOKPLOY_PASSWORD</code> are correct — set them with{" "}
          <code className="font-mono">switchyard config</code> for the managed container, or in{" "}
          <code className="font-mono">.env.local</code> when running from source.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-[var(--color-bg-elevated)] p-3 font-mono text-xs text-[var(--color-fg-muted)]">
          {message}
        </pre>
      </div>
    </div>
  );
}
