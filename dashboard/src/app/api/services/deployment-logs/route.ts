import { apiSessionFailure } from "@/lib/api-auth";
import { stripVTControlCharacters } from "node:util";
import { unstable_rethrow } from "next/navigation";

import { loadWorkspace, readDeploymentLogs } from "@/lib/dokploy";
import { deploymentForService } from "@/lib/deployment-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const serviceId = params.get("serviceId");
  const deploymentId = params.get("deploymentId");
  if (!serviceId || !deploymentId) {
    return Response.json({ error: "Missing service or deployment." }, { status: 400 });
  }

  // Revalidate this user's workspace on every read; never share an allowlist
  // across sessions or accept a browser-supplied log path.
  let services;
  try {
    ({ services } = await loadWorkspace({ includeRuntime: false }));
  } catch (error) {
    const denied = apiSessionFailure(error);
    if (denied) return denied;
    unstable_rethrow(error);
    return Response.json({ error: "Workspace unavailable.", code: "unavailable" }, { status: 503 });
  }
  if (!deploymentForService(services, serviceId, deploymentId)) {
    return Response.json({ error: "Deployment unavailable.", code: "forbidden" }, { status: 403 });
  }

  try {
    const logs = await readDeploymentLogs(deploymentId);
    return Response.json(
      { logs: stripVTControlCharacters(logs) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    const denied = apiSessionFailure(error);
    if (denied) return denied;
    unstable_rethrow(error);
    return Response.json({ error: "Deployment logs unavailable.", code: "unavailable" }, { status: 503 });
  }
}
