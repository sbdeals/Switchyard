import { apiSessionFailure } from "@/lib/api-auth";
import { unstable_rethrow } from "next/navigation";

import { inspectServiceImages } from "@/lib/docker";
import { request as dokployRequest } from "@/lib/dokploy";
import { checkServiceImageUpdates } from "@/lib/image-update";
import { lookupRegistryImage } from "@/lib/image-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const id = params.get("id");
  if (!id || (kind !== "application" && kind !== "database" && kind !== "compose")) {
    return Response.json({ error: "missing service kind or id" }, { status: 400 });
  }

  try {
    const result = await checkServiceImageUpdates(kind, id, {
      request: dokployRequest,
      inspect: inspectServiceImages,
      lookup: lookupRegistryImage,
    });
    if (!result) return Response.json({ error: "unknown service", code: "forbidden" }, { status: 403 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const denied = apiSessionFailure(error);
    if (denied) return denied;
    unstable_rethrow(error);
    return Response.json({ error: "Image check is unavailable. Try again shortly.", code: "unavailable" }, { status: 503 });
  }
}
