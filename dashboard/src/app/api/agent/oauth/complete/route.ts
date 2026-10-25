import { completeLogin } from "@/lib/agent/oauth";
import { agentConfigAccess } from "@/lib/agent/authorization";
import { setOAuthCredential } from "@/lib/agent/key-store";
import { sessionFromRequest, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { code } -> exchange the one-time code the user pasted back for
 * subscription tokens and store them. On success { ok: true }; the UI then
 * re-reads /api/agent/config for the new (masked) status.
 *
 * The proxy only proves a session cookie EXISTS; the sealed cookie is verified
 * here because the stored tokens become the process-wide agent credential.
 */
export async function POST(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return unauthorized();
  const access = await agentConfigAccess(session);
  if (!access.canConfigure) return Response.json({ error: access.error }, { status: 403 });

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return Response.json({ error: "Paste the authorization code from the Claude page." }, { status: 400 });
  }

  try {
    const tokens = await completeLogin(code);
    setOAuthCredential(tokens);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Sign-in failed." },
      { status: 400 },
    );
  }
  return Response.json({ ok: true });
}
