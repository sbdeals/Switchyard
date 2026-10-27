export type WorkspaceErrorKind = "unreachable" | "auth" | "unknown";

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Classify transport failures without treating programming/API errors as outages.
 * Call unstable_rethrow first: framework control flow must still propagate.
 */
export function classifyWorkspaceError(error: unknown): WorkspaceErrorKind {
  const seen = new Set<object>();
  let unreachable = false;
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const current = error as {
      name?: string;
      message?: string;
      code?: string;
      status?: number;
      digest?: string;
      cause?: unknown;
    };
    if (
      current.status === 401 ||
      current.status === 403 ||
      (typeof current.digest === "string" && current.digest.startsWith("NEXT_REDIRECT;"))
    ) {
      return "auth";
    }
    unreachable ||= current.name === "TimeoutError" || current.name === "AbortError" ||
      (current.name === "TypeError" && current.message === "fetch failed") ||
      CONNECTION_CODES.has(current.code ?? "");
    error = current.cause;
  }
  return unreachable ? "unreachable" : "unknown";
}
