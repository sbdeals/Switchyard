import { knownAppNames } from "@/lib/dokploy";
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

  // Guard: only serve metrics for a real service. If Dokploy can't be reached to
  // build the allow-list, fall through (the scraper only holds data for real
  // Traefik services anyway) rather than blanking out live metrics.
  let known: Set<string> | null = null;
  try {
    known = await knownAppNames();
  } catch {
    known = null;
  }
  if (known && !known.has(app)) {
    return Response.json({ available: false, points: [] });
  }

  return Response.json(getHttpMetrics(app, range));
}
