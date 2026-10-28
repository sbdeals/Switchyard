import { apiSessionFailure } from "@/lib/api-auth";
import { unstable_rethrow } from "next/navigation";

import { diagnoseDeployment } from "@/lib/deploy-diagnosis";
import { DeploymentLogError, readFailedDeploymentLog } from "@/lib/deployment-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const deploymentId = new URL(request.url).searchParams.get("deploymentId") ?? "";
  try {
    const log = await readFailedDeploymentLog(deploymentId);
    return Response.json({ diagnosis: diagnoseDeployment(log) });
  } catch (error) {
    const denied = apiSessionFailure(error);
    if (denied) return denied;
    unstable_rethrow(error);
    if (error instanceof DeploymentLogError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Upstream errors can include paths or log output; keep those server-side.
    return Response.json({ error: "Build log unavailable for this deployment.", code: "unavailable" }, { status: 503 });
  }
}
