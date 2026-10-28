import { requireApiSession } from "@/lib/api-auth";
import { completeLogin } from "@/lib/agent/oauth";
import { setOAuthCredential } from "@/lib/agent/key-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * POST { code } -> exchange the one-time code the user pasted back for
 * subscription tokens and store them. On success { ok: true }; the UI then
 * re-reads /api/agent/config for the new (masked) status.
 */
export async function POST(req: Request) {
  const denied = await requireApiSession(req);
  if (denied) return denied;

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
