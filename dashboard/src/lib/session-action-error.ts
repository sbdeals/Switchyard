import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { SESSION_EXPIRED_MESSAGE, type SessionExpiredResult } from "./action-call";

/** Only auth redirects become recoverable action results; other control flow propagates. */
export function sessionExpiredResult(error: unknown): SessionExpiredResult | null {
  if (!isRedirectError(error)) return null;
  const path = getURLFromRedirectError(error);
  if (path !== "/login" && path !== "/api/session/expired" && path !== "/login?expired=1") return null;
  return { ok: false, error: SESSION_EXPIRED_MESSAGE, code: "unauthenticated" };
}
