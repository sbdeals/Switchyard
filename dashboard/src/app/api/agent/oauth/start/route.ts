import { startLogin } from "@/lib/agent/oauth";
import { requireAgentSession } from "@/lib/agent/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST -> { url }. Begins "Sign in with Claude": mints a PKCE challenge and
 * returns the Claude authorize URL for the user to open and approve.
 */
export async function POST(req: Request) {
  const denied = requireAgentSession(req);
  if (denied) return denied;
  return Response.json(startLogin());
}
