import { unstable_rethrow } from "next/navigation";

import { followLogs } from "@/lib/docker";
import { knownAppNames } from "@/lib/dokploy";
import { sseFromLines, sseOnce } from "@/lib/sse";
import { queryLogs } from "@/lib/store";

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

  // Every connection replays the tail, so replace the client's previous buffer.
  const reset = "event: reset\ndata: {}\n\n";
  const src = await followLogs(app, 300, allowed);
  if (!src) {
    let history = "";
    try {
      // The collector persists under service.appName, the same allowlisted key.
      const lines = await queryLogs(app, 0, 300);
      history = lines.map((line) => `data: ${JSON.stringify({ ...line, stored: true })}\n\n`).join("");
    } catch (e) {
      unstable_rethrow(e);
      // History is optional; preserve the stopped marker if the store fails.
    }
    const line = JSON.stringify({ ts: Date.now(), text: "— container is not running —" });
    return sseOnce(`${reset}${history}data: ${line}\n\n`);
  }

  return sseFromLines(src, request, (line, continuation) => {
    // Only the first fragment of a line has an RFC3339 docker timestamp.
    const m = continuation ? null : line.match(/^(\S+)\s([\s\S]*)$/);
    const parsed = m ? Date.parse(m[1]) : NaN;
    const ts = Number.isNaN(parsed) ? Date.now() : parsed;
    return `data: ${JSON.stringify({ ts, text: m ? m[2] : line })}\n\n`;
  }, reset);
}
