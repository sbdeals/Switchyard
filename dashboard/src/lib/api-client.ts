import { SESSION_EXPIRED_MESSAGE } from "./action-call";
import { setSessionExpired } from "./session-expiry";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly readonlyRejected = false) {
    super(message);
  }
}

/** Preserve success bodies (JSON, SSE, downloads); decode errors consistently. */
export async function apiFetch(...args: Parameters<typeof fetch>): Promise<Response> {
  const response = await fetch(...args);
  const loginRedirect = response.redirected && new URL(response.url).pathname === "/login";
  if (response.ok && !loginRedirect) return response;
  const data = await response.json().catch(() => null) as {
    error?: unknown; code?: unknown; readonlyRejected?: unknown;
  } | null;
  if (response.status === 401 || loginRedirect || data?.code === "unauthenticated") {
    setSessionExpired(true);
    throw new ApiError(SESSION_EXPIRED_MESSAGE, 401, "unauthenticated");
  }
  throw new ApiError(
    typeof data?.error === "string" ? data.error : `Request failed (HTTP ${response.status}). Try again.`,
    response.status,
    typeof data?.code === "string" ? data.code : undefined,
    data?.readonlyRejected === true,
  );
}

/** EventSource hides HTTP errors; probe only after a failed connection. */
export async function logConnectionError(url: string, signal: AbortSignal): Promise<void> {
  const response = await apiFetch(url, { signal, cache: "no-store" });
  // The connection recovered. EventSource will retry; release this probe stream.
  await response.body?.cancel();
}
