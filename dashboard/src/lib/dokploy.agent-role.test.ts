import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./docker", () => ({}));

const session = { dokployCookie: "sess=member-fixture", email: "owner@example.test", iat: Date.now() };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DOKPLOY_URL", "http://dokploy.test");
  vi.stubEnv("DOKPLOY_AUTH_ORIGIN", "");
  vi.stubEnv("DOKPLOY_ORIGIN", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("authoritative agent configuration role", () => {
  it.each(["owner", "admin"])("allows the Dokploy %s membership using only the request's cookie", async (role) => {
    fetchMock.mockResolvedValue(Response.json({ role, user: { role: "member" } }));
    const { agentConfigAccess } = await import("./agent/authorization");
    expect(await agentConfigAccess(session)).toEqual({ canConfigure: true, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://dokploy.test/api/user.get", expect.objectContaining({
      headers: { Origin: "http://dokploy.test", Cookie: session.dokployCookie },
      cache: "no-store",
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
  });

  it.each(["member", "custom", "Owner", "admin,member"])("denies %s even if the nested user says admin", async (role) => {
    fetchMock.mockResolvedValue(Response.json({ role, user: { role: "admin" } }));
    const { agentConfigAccess } = await import("./agent/authorization");
    expect(await agentConfigAccess(session)).toMatchObject({
      canConfigure: false,
      error: "Only workspace admins can change the agent provider.",
    });
  });

  it.each([null, {}, { user: { role: "owner" } }, { role: false }, { role: "" }])("fails closed for a malformed membership: %j", async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    const { agentConfigAccess } = await import("./agent/authorization");
    expect(await agentConfigAccess(session)).toMatchObject({ canConfigure: false, error: expect.stringContaining("Could not verify") });
  });

  it.each([401, 403, 500])("fails closed on HTTP %i without a system-session fallback", async (status) => {
    fetchMock.mockResolvedValue(new Response("upstream failure", { status }));
    const { agentConfigAccess } = await import("./agent/authorization");
    expect(await agentConfigAccess(session)).toMatchObject({ canConfigure: false, error: expect.stringContaining("Could not verify") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a timeout or malformed JSON", async () => {
    const { agentConfigAccess } = await import("./agent/authorization");
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    expect((await agentConfigAccess(session)).canConfigure).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("not json"));
    expect((await agentConfigAccess(session)).canConfigure).toBe(false);
  });

  it("rechecks membership after a demotion", async () => {
    const { agentConfigAccess } = await import("./agent/authorization");
    fetchMock.mockResolvedValueOnce(Response.json({ role: "admin" }));
    expect((await agentConfigAccess(session)).canConfigure).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ role: "member" }));
    expect((await agentConfigAccess(session)).canConfigure).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
