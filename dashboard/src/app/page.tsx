import { unstable_rethrow } from "next/navigation";

import { loadWorkspace, inferEdges } from "@/lib/dokploy";
import { ensureCollector } from "@/lib/collector";
import { Workspace } from "@/components/Workspace";
import { LogoutButton } from "@/components/LogoutButton";
import { DokployUnavailable } from "@/components/DokployUnavailable";
import { classifyWorkspaceError } from "@/lib/workspace-error";

// Always fetch fresh state from Dokploy.
export const dynamic = "force-dynamic";

export default async function Page() {
  // Start the background metrics/logs collector on first workspace load. Lazy
  // singleton — safe to call on every request (see lib/collector.ts).
  ensureCollector();

  let result: Awaited<ReturnType<typeof loadWorkspace>>;
  try {
    result = await loadWorkspace();
  } catch (e) {
    // Let framework control-flow errors (e.g. redirect to /login on an expired
    // session) propagate instead of rendering them as an error panel.
    unstable_rethrow(e);
    if (classifyWorkspaceError(e) !== "unreachable") throw e;
    return (
      <>
        <LogoutButton />
        <DokployUnavailable />
      </>
    );
  }

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
