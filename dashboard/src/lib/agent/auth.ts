import "server-only";
import { openSession, SESSION_COOKIE } from "@/lib/session";

/** The proxy checks presence only. Verify the sealed cookie on every agent API path. */
export function requireAgentSession(req: Request): Response | null {
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (openSession(token)) return null;
  return Response.json({ error: "Unauthorized. Sign in at /login." }, { status: 401 });
}
