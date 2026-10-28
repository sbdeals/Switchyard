import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, logConnectionError } from "./api-client";
import { SESSION_EXPIRED_MESSAGE } from "./action-call";
import { isSessionExpired, setSessionExpired, subscribeSessionExpiry } from "./session-expiry";
import { downloadServiceLogs } from "./log-export-client";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  setSessionExpired(false);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); setSessionExpired(false); });

describe("API error contract", () => {
  it.each([
    [401, "unauthenticated", SESSION_EXPIRED_MESSAGE],
    [403, "forbidden", "Unknown or unmanaged service."],
    [503, "unavailable", "Workspace unavailable."],
  ] as const)("decodes JSON HTTP %s into a renderable error and signals expiry only for 401", async (status, code, message) => {
    fetchMock.mockResolvedValue(Response.json({ error: message, code }, { status }));
    const changed = vi.fn();
    const unsubscribe = subscribeSessionExpiry(changed);
    try {
      await expect(apiFetch("/api/services/exec")).rejects.toMatchObject({ message, status, code });
      expect(isSessionExpired()).toBe(status === 401);
      expect(changed).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    } finally { unsubscribe(); }
  });

  it("uses the existing session recovery message for a proxy's plain-text 401", async () => {
    fetchMock.mockResolvedValue(new Response("Not signed in", { status: 401 }));
    await expect(apiFetch("/api/services/postgres")).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(isSessionExpired()).toBe(true);
  });

  it("detects a followed login redirect before parsing HTML as success JSON", async () => {
    const response = new Response("<html>Sign in</html>");
    Object.defineProperties(response, { redirected: { value: true }, url: { value: "http://dashboard.test/login?next=%2F" } });
    fetchMock.mockResolvedValue(response);
    await expect(apiFetch("/api/agent/config")).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(isSessionExpired()).toBe(true);
  });

  it("preserves the Postgres read-only rejection hint", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Writes disabled", readonlyRejected: true }, { status: 400 }));
    await expect(apiFetch("/api/services/postgres")).rejects.toMatchObject({ message: "Writes disabled", readonlyRejected: true });
  });

  it.each(["application/json", "text/event-stream", "application/octet-stream"])("leaves successful %s bodies unread", async (contentType) => {
    const response = new Response("original body", { headers: { "Content-Type": contentType } });
    fetchMock.mockResolvedValue(response);
    expect(await apiFetch("/api/test")).toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe("original body");
  });

  it.each([401, 403, 503])("surfaces log-download HTTP %s without creating a downloaded file", async (status) => {
    fetchMock.mockResolvedValue(Response.json({ error: "Download denied" }, { status }));
    // No document or object-URL API is installed: failures must return before saving.
    await expect(downloadServiceLogs("test-app", 1000, "log")).rejects.toThrow(status === 401 ? SESSION_EXPIRED_MESSAGE : "Download denied");
  });

  it("cancels a successful EventSource error probe so it cannot leave another log stream running", async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const controller = new AbortController();
    await logConnectionError("/api/services/logs?app=test", controller.signal);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/services/logs?app=test", { signal: controller.signal, cache: "no-store" });
  });
});
