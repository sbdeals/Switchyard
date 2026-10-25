import "server-only";
import { DokploySessionExpiredError, getDokployRole } from "../dokploy";
import { SESSION_COOKIE, sessionFromRequest, shouldSecureCookie, type SwitchyardSession } from "../session";

type AgentSessionResult =
  | { session: SwitchyardSession; role: string }
  | { response: Response; error: string };

function denied(req: Request, status: 401 | 503): AgentSessionResult {
  const error = status === 401
    ? "Session expired. Sign in again at /login."
    : "Could not verify your session with Dokploy. Try again when Dokploy is available.";
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (status === 401) {
    const secure = shouldSecureCookie(req.headers.get("x-forwarded-proto"), process.env.SWITCHYARD_ASSUME_HTTPS);
    headers.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  }
  return { response: Response.json({ error }, { status, headers }), error };
}

/**
 * Open the envelope AND verify its own Dokploy session before any agent access.
 * No positive or negative cache: logout/revocation takes effect on the next
 * request or stream checkpoint, with no cache TTL or logout invalidation state.
 * Return the membership role from the same call for configuration authorization.
 */
export async function requireActiveAgentSession(req: Request): Promise<AgentSessionResult> {
  const session = sessionFromRequest(req);
  if (!session?.dokployCookie) return denied(req, 401);
  try {
    const role = await getDokployRole(session.dokployCookie);
    return { session, role };
  } catch (e) {
    return denied(req, e instanceof DokploySessionExpiredError ? 401 : 503);
  }
}
