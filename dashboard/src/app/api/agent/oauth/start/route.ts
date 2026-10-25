import { startLogin } from "@/lib/agent/oauth";
import { agentConfigAccess } from "@/lib/agent/authorization";
import { requireActiveAgentSession } from "@/lib/agent/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST -> { url }. Begins "Sign in with Claude": mints a PKCE challenge and
 * returns the Claude authorize URL for the user to open and approve.
 *
 * The proxy only proves a session cookie EXISTS; the sealed cookie is verified
 * here before a sign-in (whose result becomes the process-wide credential) can
 * be started.
 */
export async function POST(req: Request) {
  const auth = await requireActiveAgentSession(req);
  if ("response" in auth) return auth.response;
  const access = agentConfigAccess(auth.role);
  if (!access.canConfigure) return Response.json({ error: access.error }, { status: 403 });
  return Response.json(startLogin());
}
