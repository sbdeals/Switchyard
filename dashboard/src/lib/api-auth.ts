import "server-only";
import { unstable_rethrow } from "next/navigation";
import { knownAppNamesForRequest, verifySessionForRequest } from "./dokploy";
import { SESSION_EXPIRED_MESSAGE } from "./action-call";
import { sessionExpiredResult } from "./session-action-error";

export function unauthorized(): Response {
  return Response.json({ error: SESSION_EXPIRED_MESSAGE, code: "unauthenticated" },
    { status: 401, headers: { "Cache-Control": "no-store" } });
}

/** Convert auth redirects only at the API boundary; Server Actions keep #74. */
export function apiSessionFailure(error: unknown): Response | null {
  if (sessionExpiredResult(error)) return unauthorized();
  if (error && typeof error === "object" && "status" in error) {
    if (error.status === 401) return unauthorized();
    if (error.status === 403) {
      return Response.json({ error: "Access denied.", code: "forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }
  return null;
}

export function authorizationFailure(error: unknown): Response {
  const denied = apiSessionFailure(error);
  if (denied) return denied;
  unstable_rethrow(error);
  return Response.json({ error: "Workspace unavailable.", code: "unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } });
}

/** For endpoints without a service target (agent credentials, models, etc.). */
export async function requireApiSession(request: Request): Promise<Response | null> {
  try {
    await verifySessionForRequest(request);
    return null;
  } catch (error) {
    return authorizationFailure(error);
  }
}

/** Authenticate and check ownership before any Docker/store/cache access. */
export async function requireAppAccess(request: Request, app: string): Promise<Set<string> | Response> {
  try {
    const allowed = await knownAppNamesForRequest(request);
    return allowed.has(app) ? allowed : Response.json(
      { error: "Unknown or unmanaged service.", code: "forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authorizationFailure(error);
  }
}
