import { unstable_rethrow } from "next/navigation";

import { followLogs } from "@/lib/docker";
import { knownAppNames } from "@/lib/dokploy";
import { sseFromLines, sseOnce } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stream a container's logs as Server-Sent Events: data: {"ts","text"}.
export async function GET(request: Request) {
  const app = new URL(request.url).searchParams.get("app");
  if (!app) return new Response("missing ?app", { status: 400 });

  // Only tail containers backing this user's Dokploy services (fail closed if
  // the workspace can't be read, so we never attach to an arbitrary container).
  let allowed: Set<string>;
  try {
    allowed = await knownAppNames();
  } catch (e) {
    unstable_rethrow(e);
    return new Response("workspace unavailable", { status: 503 });
  }
  if (!allowed.has(app)) return new Response("unknown app", { status: 403 });

  const src = await followLogs(app, 300, allowed);
  if (!src) {
    const line = JSON.stringify({ ts: Date.now(), text: "— container is not running —" });
    return sseOnce(`data: ${line}\n\n`);
  }

  return sseFromLines(src, request, (line) => {
    // Lines are prefixed with an RFC3339 docker timestamp.
    const m = line.match(/^(\S+)\s([\s\S]*)$/);
    const parsed = m ? Date.parse(m[1]) : NaN;
    const ts = Number.isNaN(parsed) ? Date.now() : parsed;
    return `data: ${JSON.stringify({ ts, text: m ? m[2] : line })}\n\n`;
  });
}
