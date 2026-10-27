import { unstable_rethrow } from "next/navigation";

import { readServiceStats } from "@/lib/docker";
import { loadWorkspace } from "@/lib/dokploy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A fresh ownership check precedes every read, including cached Docker samples.
export async function GET(request: Request) {
  const app = new URL(request.url).searchParams.get("app");
  if (!app) return new Response("missing ?app", { status: 400 });

  // Only sample containers backing this user's Dokploy services (fail closed).
  let allowed: Set<string>;
  try {
    const { services } = await loadWorkspace({ includeRuntime: false });
    allowed = new Set(services.map((service) => service.appName).filter(Boolean));
  } catch (e) {
    unstable_rethrow(e);
    return new Response("workspace unavailable", { status: 503 });
  }
  if (!allowed.has(app)) return new Response("unknown app", { status: 403 });

  return Response.json(await readServiceStats(app, allowed), {
    headers: { "Cache-Control": "no-store" },
  });
}
