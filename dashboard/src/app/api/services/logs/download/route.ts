import { unstable_rethrow } from "next/navigation";

import { readRecentLogs } from "@/lib/docker";
import { knownAppNames } from "@/lib/dokploy";
import { capLogLines, logDownloadFilename, logDownloadStream } from "@/lib/log-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const app = params.get("app");
  if (!app) return new Response("missing ?app", { status: 400 });

  let allowed: Set<string>;
  try {
    allowed = await knownAppNames();
  } catch (e) {
    unstable_rethrow(e);
    return new Response("workspace unavailable", { status: 503 });
  }
  if (!allowed.has(app)) return new Response("unknown app", { status: 403 });

  const format = params.get("format") ?? "log";
  if (format !== "log" && format !== "json") return new Response("unknown format", { status: 400 });
  const limit = capLogLines(params.get("lines"));
  try {
    const lines = (await readRecentLogs(app, limit, allowed)).slice(-limit);
    return new Response(logDownloadStream(lines, format), {
      headers: {
        "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${logDownloadFilename(app, format)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    return new Response("logs unavailable", { status: 503 });
  }
}
