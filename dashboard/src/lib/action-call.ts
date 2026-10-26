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

/** Only allow local return paths, including their query and fragment. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return "/";
  const url = new URL(value, "http://localhost");
  // Dot segments can normalize a seemingly local path into //another-host.
  if (url.pathname.startsWith("//")) return "/";
  if (url.pathname.replace(/\/+$/, "") === "/login") return "/";
  return url.pathname + url.search + url.hash;
}

export function signInHref(returnTo: string): string {
  return `/login?next=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
