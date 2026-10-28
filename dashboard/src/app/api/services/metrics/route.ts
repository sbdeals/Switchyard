import { readServiceStats } from "@/lib/docker";
import { requireAppAccess } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A fresh ownership check precedes every read, including cached Docker samples.
export async function GET(request: Request) {
  const app = new URL(request.url).searchParams.get("app");
  if (!app) return new Response("missing ?app", { status: 400 });

  const allowed = await requireAppAccess(request, app);
  if (allowed instanceof Response) return allowed;

  return Response.json(await readServiceStats(app, allowed), {
    headers: { "Cache-Control": "no-store" },
  });
}
