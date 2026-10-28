import { apiSessionFailure } from "@/lib/api-auth";
import { unstable_rethrow } from "next/navigation";

import { inferEdges, loadWorkspace } from "@/lib/dokploy";
import { redactServiceForClient } from "@/lib/service-redaction";
import { buildServiceReferenceGraph } from "@/lib/service-references";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    // Recheck the signed-in user's workspace on every poll.
    const { services, projects } = await loadWorkspace();
    return Response.json({ services: services.map(redactServiceForClient), projects, edges: inferEdges(services), graph: buildServiceReferenceGraph(services) }, { headers });
  } catch (error) {
    const denied = apiSessionFailure(error);
    if (denied) return denied;
    unstable_rethrow(error);
    return Response.json({ error: "Workspace unavailable.", code: "unavailable" }, { status: 503, headers });
  }
}
