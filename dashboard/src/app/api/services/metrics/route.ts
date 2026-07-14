import { unstable_rethrow } from "next/navigation";

import { followStats } from "@/lib/docker";
import { knownAppNames } from "@/lib/dokploy";
import { sseFromLines, sseOnce } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stream container resource samples as SSE: data: {"ts","cpu","memUsed","memLimit","memPct"}.
export async function GET(request: Request) {
  const app = new URL(request.url).searchParams.get("app");
  if (!app) return new Response("missing ?app", { status: 400 });

  // Only sample containers backing this user's Dokploy services (fail closed).
  let allowed: Set<string>;
  try {
    allowed = await knownAppNames();
  } catch (e) {
    unstable_rethrow(e);
    return new Response("workspace unavailable", { status: 503 });
  }
  if (!allowed.has(app)) return new Response("unknown app", { status: 403 });

  const src = await followStats(app, allowed);
  if (!src) return sseOnce(`event: idle\ndata: {}\n\n`);

  return sseFromLines(src, request, (line) => {
    // Docker emits one JSON stats object per line.
    try {
      return `data: ${JSON.stringify(src.toSample(JSON.parse(line)))}\n\n`;
    } catch {
      return null; // partial / non-JSON chunk
    }
  });
}
