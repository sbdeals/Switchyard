import { unstable_rethrow } from "next/navigation";

import { normalizeActivity } from "@/lib/activity";
import { loadWorkspace } from "@/lib/dokploy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // loadWorkspace uses the current user's Dokploy session and visible tree.
    const { services } = await loadWorkspace();
    return Response.json(
      { entries: normalizeActivity(services) },
      {
        headers: {
          "Cache-Control": "private, max-age=10, must-revalidate",
          Vary: "Cookie",
        },
      }
    );
  } catch (error) {
    unstable_rethrow(error);
    return Response.json(
      { error: "Activity unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
