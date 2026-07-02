import { ping } from "@/lib/dokploy";

// Never cache — the whole point is a live readiness signal.
export const dynamic = "force-dynamic";

/**
 * Health probe for the container HEALTHCHECK and the `switchyard` CLI.
 *
 * GET /api/health          -> shallow: the Next.js server is up.
 * GET /api/health?deep=1   -> also signs into Dokploy and lists projects,
 *                             proving credentials + network end to end.
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  if (!deep) {
    return Response.json({ ok: true, version: process.env.SWITCHYARD_VERSION ?? "dev" });
  }
  try {
    await ping();
    return Response.json({ ok: true, dokploy: true });
  } catch (e) {
    return Response.json(
      { ok: false, dokploy: false, error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
