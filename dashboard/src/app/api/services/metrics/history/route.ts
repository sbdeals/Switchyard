import { queryMetrics, storeEnabled } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Metric history over a time range from the durable store.
 *   GET /api/services/metrics/history?app=<appName>&since=<ms>&until=<ms>
 * Returns { enabled, samples }. When no store is configured `enabled` is false
 * and the client falls back to live-only mode.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const app = url.searchParams.get("app");
  if (!app) return new Response("missing ?app", { status: 400 });

  if (!storeEnabled()) {
    return Response.json({ enabled: false, samples: [] });
  }

  const now = Date.now();
  const sinceParam = Number(url.searchParams.get("since"));
  const untilParam = Number(url.searchParams.get("until"));
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : now - 60 * 60_000;
  const until = Number.isFinite(untilParam) && untilParam > 0 ? untilParam : now;

  const samples = await queryMetrics(app, since, until);
  return Response.json({ enabled: true, samples });
}
