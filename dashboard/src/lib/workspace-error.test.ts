import { describe, expect, it } from "vitest";

import { classifyWorkspaceError } from "./workspace-error";

describe("classifyWorkspaceError", () => {
  it.each([
    new TypeError("fetch failed"),
    new DOMException("The operation timed out", "TimeoutError"),
    new DOMException("The operation was aborted", "AbortError"),
    ...[
      "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
      "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
    ].map((code) => new Error("Request failed", { cause: { code } })),
  ])("recognizes a transport failure: %s", (error) => {
    expect(classifyWorkspaceError(error)).toBe("unreachable");
  });

  it.each([
    { status: 401 },
    { status: 403 },
    { digest: "NEXT_REDIRECT;replace;/login;307;" },
    new Error("Request failed", { cause: { status: 401 } }),
    new TypeError("fetch failed", { cause: { status: 403 } }),
  ])("keeps auth failures separate from outages: %s", (error) => {
    expect(classifyWorkspaceError(error)).toBe("auth");
  });

  it.each([
    undefined, null, false, "fetch failed", {}, { digest: 123 },
    { status: 500 }, { digest: "NEXT_HTTP_ERROR_FALLBACK;404" },
    new Error("fetch failed"),
    new TypeError("Cannot read properties of undefined"),
    new SyntaxError("Unexpected token in JSON"),
  ])("does not label unknown failures as outages: %s", (error) => {
    expect(classifyWorkspaceError(error)).toBe("unknown");
  });

  it("traverses nested causes and terminates on cycles", () => {
    const cause: { code?: string; cause?: unknown } = {};
    const error = new Error("Outer failure", { cause });
    cause.cause = error;
    expect(classifyWorkspaceError(error)).toBe("unknown");
    cause.code = "ECONNREFUSED";
    expect(classifyWorkspaceError(error)).toBe("unreachable");
  });
});
