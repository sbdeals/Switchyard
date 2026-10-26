import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { previewRequest, sealPreviewKey } from "./preview-access";
import type { DeployHookRecord } from "./deploy-hook-store";

let hook: DeployHookRecord;
beforeEach(() => {
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "test-encryption-secret");
  vi.stubEnv("DOKPLOY_URL", "http://127.0.0.1:3000");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
  hook = {
    serviceId: "parent", ownerId: "owner", token: "a".repeat(64), secret: "b".repeat(64), enabled: true,
    refreshToken: "native", repoUrl: "https://github.com/acme/web", branch: "main",
    previewAccess: { id: "key-id", sealedKey: sealPreviewKey("parent", "local-automation-key"), projectId: "project" },
  };
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("encrypts the key, binds it to its parent, and never uses browser credentials", async () => {
  expect(hook.previewAccess?.sealedKey).not.toContain("local-automation-key");
  await previewRequest(hook)("project.one?projectId=project");
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(String(url)).toBe("http://127.0.0.1:3000/api/project.one?projectId=project");
  expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit",
    headers: { "x-api-key": "local-automation-key" }, signal: expect.any(AbortSignal) });
  expect(init?.headers).not.toHaveProperty("Cookie");
  expect(() => previewRequest({ ...hook, serviceId: "different" })).toThrow();
});

it("rejects a missing or changed encryption key", () => {
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "wrong-key");
  expect(() => previewRequest(hook)).toThrow();
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "");
  expect(() => sealPreviewKey("parent", "key")).toThrow();
});

it("bounds the full API sequence with the same signal and redacts backend errors", async () => {
  const api = previewRequest(hook);
  await api("compose.update", { composeId: "preview" });
  vi.mocked(fetch).mockResolvedValueOnce(new Response("private backend data", { status: 403 }));
  await expect(api("compose.delete", { composeId: "preview", deleteVolumes: true })).rejects.toThrow("Preview management is unavailable.");
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(vi.mocked(fetch).mock.calls[1][1]?.signal);
});
