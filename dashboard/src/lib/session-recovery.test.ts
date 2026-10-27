import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { callAction, safeReturnTo, SESSION_EXPIRED_MESSAGE, signInHref } from "./action-call";
import { sessionExpiredResult } from "./session-action-error";
import {
  createProjectAction, updateApplicationAction, createSecurityAction,
  loadServiceEnvAction, loadComposeFileAction, loadServiceCommandsAction, loadServiceWebhookAction,
} from "@/app/actions";
import { getDatabaseConnectionAction } from "@/app/db-connect-actions";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  requireServiceOwnership: vi.fn(),
  updateApplication: vi.fn(),
  assertApplicationAccess: vi.fn(),
  createSecurity: vi.fn(),
  getServiceEnvironment: vi.fn(),
  getServiceComposeFile: vi.fn(),
  getServiceCommands: vi.fn(),
  getServiceWebhook: vi.fn(),
  getDatabasePassword: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/docker", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/docker")>()), listVolumeDiskUsage: vi.fn(async () => null) }));
vi.mock("@/lib/dokploy", () => mocks);
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const expired = { ok: false, error: SESSION_EXPIRED_MESSAGE, code: "unauthenticated" };

beforeEach(() => vi.resetAllMocks());

describe("server action recovery", () => {
  const actions = [
    { name: "ordinary mutation", run: () => createProjectAction("draft name"), source: mocks.createProject },
    { name: "sensitive mutation", run: () => updateApplicationAction("app", { command: "draft command" }), source: mocks.requireServiceOwnership },
    { name: "security mutation", run: () => createSecurityAction("app", "user", "test-password"), source: mocks.assertApplicationAccess },
    { name: "env loader", run: () => loadServiceEnvAction("application", "app"), source: mocks.getServiceEnvironment },
    { name: "compose loader", run: () => loadComposeFileAction("compose"), source: mocks.getServiceComposeFile },
    { name: "command loader", run: () => loadServiceCommandsAction("application", "app"), source: mocks.getServiceCommands },
    { name: "webhook loader", run: () => loadServiceWebhookAction("app"), source: mocks.getServiceWebhook },
    { name: "database credential loader", run: () => getDatabaseConnectionAction("postgres", "db"), source: mocks.getDatabasePassword },
  ];

  describe.each(["/login", "/api/session/expired"])("auth redirect to %s", (path) => {
    it.each(actions)("returns a recoverable result for $name without revalidation", async ({ run, source }) => {
      source.mockImplementation(() => redirect(path));
      expect(await run()).toEqual(expired);
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(mocks.updateApplication).not.toHaveBeenCalled();
      expect(mocks.createSecurity).not.toHaveBeenCalled();
    });
  });

  it.each(actions)("preserves other redirect control flow for $name", async ({ run, source }) => {
    source.mockImplementation(() => redirect("/other"));
    await expect(run()).rejects.toMatchObject({ digest: expect.stringContaining(";/other;") });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not mistake ordinary errors or arbitrary redirect targets for auth expiry", () => {
    expect(sessionExpiredResult(new Error("NEXT_REDIRECT"))).toBeNull();
    try { redirect("https://evil.com/login"); } catch (error) {
      expect(sessionExpiredResult(error)).toBeNull();
    }
  });
});

describe("client recovery contract", () => {
  it.each(["result", "proxy rejection"])("notifies expiry for a %s and permits retry", async (mode) => {
    const notify = vi.fn();
    const action = vi.fn();
    if (mode === "result") action.mockResolvedValueOnce(expired);
    else action.mockRejectedValueOnce(new Error(SESSION_EXPIRED_MESSAGE));
    action.mockResolvedValueOnce({ ok: true });
    expect(await callAction(action, notify)).toEqual(expired);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(await callAction(action, notify)).toEqual({ ok: true });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("leaves ordinary failures and unrelated redirects unchanged", async () => {
    const notify = vi.fn();
    const error = new Error("Network failed");
    await expect(callAction(async () => { throw error; }, notify)).rejects.toBe(error);
    await expect(callAction(async () => redirect("/other"), notify)).rejects.toThrow("NEXT_REDIRECT");
    expect(await callAction(async () => ({ ok: false, error: "Invalid value" }), notify))
      .toEqual({ ok: false, error: "Invalid value" });
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(["//evil.com", "https://evil.com", "/a/..//evil.com", "/login", "/a/../login"])(
    "uses the canonical safe next path for %s", (value) => {
      expect(safeReturnTo(value)).toBe("/");
      expect(new URL(signInHref(value), "http://localhost").searchParams.get("next")).toBe("/");
    },
  );
});
