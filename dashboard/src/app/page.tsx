import { createHash, randomUUID } from "node:crypto";
import { Suspense } from "react";
import { unstable_rethrow } from "next/navigation";
import { cookies } from "next/headers";
import { openSession, SESSION_COOKIE } from "@/lib/session";

import { loadWorkspace, inferEdges } from "@/lib/dokploy";
import { redactServiceForClient } from "@/lib/service-redaction";
import { ensureCollector } from "@/lib/collector";
import { Workspace } from "@/components/Workspace";
import { LogoutButton } from "@/components/LogoutButton";
import { DokployUnavailable } from "@/components/DokployUnavailable";
import { ErrorPanel } from "@/components/ErrorPanel";
import { redactErrorMessage } from "@/lib/error-redaction";
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
    const kind = classifyWorkspaceError(e);
    if (kind === "auth") throw e;
    const scrubbedDetails = redactErrorMessage(e, "Could not load workspace.");
    if (kind === "unreachable") {
      return (
        <>
          <LogoutButton />
          <DokployUnavailable scrubbedDetails={scrubbedDetails} />
        </>
      );
    }

    const reference = randomUUID().slice(0, 8);
    console.error(`Workspace load failed (${reference}): ${scrubbedDetails}`);
    return (
      <>
        <LogoutButton />
        <ErrorPanel reference={reference} scrubbedDetails={scrubbedDetails}>
          {/* Reload to retry the server-side workspace load. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="rounded-lg bg-[var(--color-brand-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-deep)]">
            Retry
          </a>
        </ErrorPanel>
      </>
    );
  }

  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);
  const notificationScope = createHash("sha256").update(session?.email ?? "").digest("hex");

  return (
    <>
      <LogoutButton />
      <Suspense>
        <Workspace
          services={result.services.map(redactServiceForClient)}
          projects={result.projects}
          edges={inferEdges(result.services)}
          notificationScope={notificationScope}
        />
      </Suspense>
    </>
  );
}
