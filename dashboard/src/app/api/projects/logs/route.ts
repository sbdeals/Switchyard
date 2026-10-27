import { unstable_rethrow } from "next/navigation";

import { getProjectLogs, logRangeMs, ProjectLogScopeError } from "@/lib/project-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const projectId = params.get("projectId");
  const environmentId = params.get("environmentId");
  const rangeMs = logRangeMs(params.get("range") ?? "15m");
  if (!projectId || !environmentId || !rangeMs) {
    return Response.json({ error: "projectId, environmentId and a valid range (15m, 1h, 6h) are required" }, { status: 400 });
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  try {
    const result = await getProjectLogs(projectId, environmentId, rangeMs, signal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: error instanceof ProjectLogScopeError
      ? "Unknown project or environment"
      : "Project logs unavailable. Check the local Docker socket and Dokploy connection." },
    { status: error instanceof ProjectLogScopeError ? 403 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
