import { safeNextPath } from "./deeplink";

/** Shared contract between the proxy and client-side action callers. */
export const SESSION_EXPIRED_MESSAGE = "Your session expired. Sign in again.";

export type SessionExpiredResult = {
  ok: false;
  error: string;
  code: "unauthenticated";
};

/** Handle proxy rejections and action auth results without leaving the editor. */
export async function callAction<T>(
  action: () => Promise<T>,
  onSessionExpired: () => void,
): Promise<T | SessionExpiredResult> {
  try {
    const result = await action();
    if (
      result && typeof result === "object" && "ok" in result && result.ok === false &&
      "code" in result && result.code === "unauthenticated"
    ) {
      onSessionExpired();
    }
    return result;
  } catch (error) {
    // Leave ordinary failures and Next's redirect control flow unchanged.
    if (!(error instanceof Error) || error.message !== SESSION_EXPIRED_MESSAGE) throw error;
    onSessionExpired();
    return { ok: false, error: SESSION_EXPIRED_MESSAGE, code: "unauthenticated" };
  }
}

/** Compatibility name for callers of the original recovery helper. */
export function safeReturnTo(value: unknown): string {
  return safeNextPath(value);
}

export function signInHref(nextPath: string): string {
  // Clear a locally valid but upstream-revoked cookie using main's expiry flow.
  return `/api/session/expired?next=${encodeURIComponent(safeNextPath(nextPath))}`;
}
