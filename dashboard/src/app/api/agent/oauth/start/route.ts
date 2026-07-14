import { startLogin } from "@/lib/agent/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The proxy already gates these routes behind the dashboard login; this
// double-checks the session cookie actually exists before starting a sign-in.
function assertSession(req: Request): Response | null {
  const cookie = req.headers.get("cookie") ?? "";
  if (!/(?:^|;\s*)switchyard_session=/.test(cookie)) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  return null;
}

/**
 * POST -> { url }. Begins "Sign in with Claude": mints a PKCE challenge and
 * returns the Claude authorize URL for the user to open and approve.
 */
export async function POST(req: Request) {
  const denied = assertSession(req);
  if (denied) return denied;
  return Response.json(startLogin());
}
