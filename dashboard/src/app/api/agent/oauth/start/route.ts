import { requireApiSession } from "@/lib/api-auth";
import { startLogin } from "@/lib/agent/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * POST -> { url }. Begins "Sign in with Claude": mints a PKCE challenge and
 * returns the Claude authorize URL for the user to open and approve.
 */
export async function POST(req: Request) {
  const denied = await requireApiSession(req);
  if (denied) return denied;
  return Response.json(startLogin());
}
