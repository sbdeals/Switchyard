import { requireAppAccess } from "@/lib/api-auth";
import { getHttpMetrics } from "@/lib/traefik-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?app=<appName>&range=<minutes> -> { available, points }.
// `available:false` means the Traefik metrics endpoint has never been reached.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const app = url.searchParams.get("app");
  if (!app) return Response.json({ error: "missing ?app" }, { status: 400 });

  const rangeRaw = Number(url.searchParams.get("range"));
  const range = Number.isFinite(rangeRaw) && rangeRaw > 0 ? Math.min(rangeRaw, 1440) : 60;

  const allowed = await requireAppAccess(request, app);
  if (allowed instanceof Response) return allowed;

  return Response.json(getHttpMetrics(app, range));
}
