import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "sealed" }) }) }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Login required"); } }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-session",
  openSession: () => ({ dokployCookie: "current-user-session" }),
}));
vi.mock("./docker", () => ({}));

import {
  assertApplicationAccess,
  createRedirect,
  updateRedirect,
  deleteRedirect,
  createSecurity,
  updateSecurity,
  deleteSecurity,
} from "./dokploy";

const fetchMock = vi.fn<typeof fetch>();
const tree = [{ environments: [{ applications: [{ applicationId: "owned" }] }] }];
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("HTTP settings ownership", () => {
  it("checks the current user's project tree before allowing create", async () => {
    fetchMock.mockResolvedValueOnce(respond(tree));
    await expect(assertApplicationAccess("owned")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/project\.all$/);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Cookie: "current-user-session" });
  });

  it("rejects an application outside the tree without fetching its details", async () => {
    fetchMock.mockResolvedValueOnce(respond(tree));
    await expect(assertApplicationAccess("foreign", { kind: "security", id: "user" })).rejects.toThrow(/your projects/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the project tree cannot be loaded", async () => {
    fetchMock.mockResolvedValueOnce(respond({ error: "unavailable" }, 503));
    await expect(assertApplicationAccess("owned")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["redirects", "security"] as const)("requires a %s row to belong to the application", async (kind) => {
    const key = kind === "redirects" ? "redirectId" : "securityId";
    fetchMock.mockResolvedValueOnce(respond(tree)).mockResolvedValueOnce(respond({ [kind]: [{ [key]: "ours" }] }));
    await expect(assertApplicationAccess("owned", { kind, id: "foreign" })).rejects.toThrow(/this application/);
    expect(fetchMock.mock.calls[1][0]).toMatch(/application\.one\?applicationId=owned$/);
  });

  it.each(["redirects", "security"] as const)("accepts an owned %s row", async (kind) => {
    const key = kind === "redirects" ? "redirectId" : "securityId";
    fetchMock.mockResolvedValueOnce(respond(tree)).mockResolvedValueOnce(respond({ [kind]: [{ [key]: "ours" }] }));
    await expect(assertApplicationAccess("owned", { kind, id: "ours" })).resolves.toBeUndefined();
  });

  it("rejects missing child collections and invalid IDs", async () => {
    await expect(assertApplicationAccess(null as unknown as string)).rejects.toThrow(/required/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(respond(tree)).mockResolvedValueOnce(respond({}));
    await expect(assertApplicationAccess("owned", { kind: "security", id: "missing" })).rejects.toThrow(/this application/);
  });
});

describe("Dokploy v0.30.10 HTTP setting payloads", () => {
  it("allowlists redirect fields and uses the native update endpoint", async () => {
    fetchMock.mockImplementation(async () => respond({}));
    const input = { regex: "^http://old/(.*)", replacement: "https://new/${1}", permanent: true, applicationId: "foreign", redirectId: "foreign" };
    await createRedirect("owned", input);
    await updateRedirect("row", input);
    await deleteRedirect("row");
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url).split("/api/")[1], JSON.parse(init?.body as string)])).toEqual([
      ["redirects.create", { applicationId: "owned", regex: input.regex, replacement: input.replacement, permanent: true }],
      ["redirects.update", { redirectId: "row", regex: input.regex, replacement: input.replacement, permanent: true }],
      ["redirects.delete", { redirectId: "row" }],
    ]);
  });

  it("allowlists credentials and discards upstream password-bearing responses", async () => {
    fetchMock.mockImplementation(async () => respond({ password: "stored-password" }));
    const input = { username: "demo", password: " exact password ", applicationId: "foreign", securityId: "foreign" };
    expect(await createSecurity("owned", input)).toBeUndefined();
    expect(await updateSecurity("row", input)).toBeUndefined();
    expect(await deleteSecurity("row")).toBeUndefined();
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url).split("/api/")[1], JSON.parse(init?.body as string)])).toEqual([
      ["security.create", { applicationId: "owned", username: "demo", password: input.password }],
      ["security.update", { securityId: "row", username: "demo", password: input.password }],
      ["security.delete", { securityId: "row" }],
    ]);
  });
});
