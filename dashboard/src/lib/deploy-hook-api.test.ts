import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./session", () => ({ SESSION_COOKIE: "switchyard_session", openSession: vi.fn() }));
vi.mock("./dokploy", () => ({ request: vi.fn() }));
vi.mock("./deploy-hook-dispatch", () => ({ dispatchDeployHook: vi.fn() }));

import { cookies } from "next/headers";
import { POST } from "@/app/api/hooks/deploy/[serviceToken]/route";
import { deletePreviewAction, getDeployHookAction, updateDeployHookAction, updatePreviewSettingsAction } from "@/app/deploy-hook-actions";
import { request } from "./dokploy";
import { dispatchDeployHook } from "./deploy-hook-dispatch";
import { openSession } from "./session";
import { findDeployHook, saveDeployHook, syncDeployHookSource, type DeployHookRecord } from "./deploy-hook-store";
import { repoStack } from "./managed-compose";

let directory: string;
let hook: DeployHookRecord;
let composeFile: string;
let userId: string;
const utf8 = new TextEncoder();

beforeEach(() => {
  vi.resetAllMocks();
  directory = mkdtempSync(path.join(tmpdir(), "switchyard-hook-api-"));
  vi.stubEnv("SWITCHYARD_DATA_DIR", directory);
  hook = {
    serviceId: "compose-1", ownerId: "owner-1", token: "a".repeat(64), secret: "b".repeat(64),
    enabled: true, refreshToken: "native-compose-token", repoUrl: "https://github.com/example/web", branch: "main",
  };
  saveDeployHook(hook);
  userId = hook.ownerId;
  composeFile = repoStack({ appName: "web", repoUrl: "https://github.com/example/web", branch: "main" });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "sealed-browser" }) } as never);
  vi.mocked(openSession).mockImplementation((token) => token ? {
    dokployCookie: "browser-cookie", email: "test@example.test", iat: Date.now(),
  } : null);
  vi.mocked(request).mockImplementation(async (procedure) => {
    if (procedure === "auth/get-session") return { user: { id: userId } };
    if (procedure.startsWith("compose.one?")) return { composeFile, refreshToken: "rotated-native-token" };
    if (procedure.startsWith("compose.getDefaultCommand?")) return "docker compose";
    if (procedure === "compose.refreshToken" || procedure === "compose.update") return {};
    throw new Error("Unexpected procedure");
  });
  vi.mocked(dispatchDeployHook).mockResolvedValue(true);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function delivery(payload: unknown = { ref: "refs/heads/main" }, options: {
  token?: string; signature?: string | null; event?: string; body?: Uint8Array; delivery?: string;
} = {}) {
  const body = options.body ?? utf8.encode(JSON.stringify(payload));
  const signature = options.signature === undefined
    ? `sha256=${createHmac("sha256", hook.secret).update(body).digest("hex")}` : options.signature;
  return POST(new Request("http://dashboard.test/api/hooks/deploy/token", {
    method: "POST", body: Buffer.from(body), headers: {
      "content-type": "application/json",
      ...(signature ? { "x-hub-signature-256": signature } : {}),
      ...(options.event ? { "x-github-event": options.event } : {}),
      ...(options.delivery ? { "x-github-delivery": options.delivery } : {}),
    },
  }), { params: Promise.resolve({ serviceToken: options.token ?? hook.token }) });
}

describe("anonymous signed deployment endpoint", () => {
  it("resolves only the token's service without a user session", async () => {
    const result = await delivery({ ref: "refs/heads/main", after: "c".repeat(40) }, { event: "push" });
    expect(result.status).toBe(202);
    expect(dispatchDeployHook).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ serviceId: "compose-1", refreshToken: hook.refreshToken }));
    expect(request).not.toHaveBeenCalled();
    expect(openSession).not.toHaveBeenCalled();
    expect(await result.text()).not.toContain(hook.secret);
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it.each([null, "sha256=bad", `sha256=${"0".repeat(64)}`])("rejects missing/bad signatures (%s)", async (signature) => {
    expect((await delivery(undefined, { signature })).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
    expect(dispatchDeployHook).not.toHaveBeenCalled();
  });

  it("rejects a signature for changed bytes", async () => {
    const signature = `sha256=${createHmac("sha256", hook.secret).update('{"ref":"refs/heads/main"}').digest("hex")}`;
    expect((await delivery({ ref: "refs/heads/main", extra: true }, { signature })).status).toBe(403);
  });

  it("returns 404 for unknown, disabled, and regenerated tokens", async () => {
    expect((await delivery(undefined, { token: "unknown" })).status).toBe(404);
    saveDeployHook({ ...hook, enabled: false });
    expect((await delivery()).status).toBe(404);
    saveDeployHook({ ...hook, token: "c".repeat(64) });
    expect((await delivery()).status).toBe(404);
    expect(dispatchDeployHook).not.toHaveBeenCalled();
  });

  it.each(["main", "refs/heads/main-extra", "refs/tags/main", "refs/heads/other"])("ignores unmatched ref %s", async (ref) => {
    expect((await delivery({ ref })).status).toBe(200);
    expect(dispatchDeployHook).not.toHaveBeenCalled();
  });

  it("reads the current tracked branch on every delivery", async () => {
    composeFile = repoStack({ appName: "web", repoUrl: "https://github.com/example/web", branch: "release/web" });
    syncDeployHookSource(hook.serviceId, composeFile);
    expect((await delivery()).status).toBe(200);
    expect((await delivery({ ref: "refs/heads/release/web" })).status).toBe(202);
    expect(dispatchDeployHook).toHaveBeenCalledTimes(1);
  });

  it("ignores signed pings and branch deletion", async () => {
    expect((await delivery({}, { event: "ping" })).status).toBe(200);
    expect((await delivery({ ref: "refs/heads/main", deleted: true })).status).toBe(200);
    expect((await delivery({ ref: "refs/heads/main", after: "0".repeat(40) })).status).toBe(200);
    expect(dispatchDeployHook).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { ref: 1 }])("rejects malformed JSON shapes (%j)", async (payload) => {
    expect((await delivery(payload)).status).toBe(400);
    expect(dispatchDeployHook).not.toHaveBeenCalled();
  });

  it("rejects malformed UTF-8 and oversized bodies", async () => {
    expect((await delivery(null, { body: new Uint8Array([0xff]) })).status).toBe(400);
    expect((await delivery(null, { body: new Uint8Array(1024 * 1024 + 1) })).status).toBe(413);
    expect(dispatchDeployHook).not.toHaveBeenCalled();
  });

  it("debounces generic retries and GitHub duplicates even with a new delivery header", async () => {
    expect((await delivery()).status).toBe(202);
    expect((await delivery()).status).toBe(200);
    const push = { ref: "refs/heads/main", after: "c".repeat(40) };
    expect((await delivery(push, { delivery: "one" })).status).toBe(202);
    expect((await delivery({ ...push, ignored: "another representation" }, { delivery: "two" })).status).toBe(200);
    expect(dispatchDeployHook).toHaveBeenCalledTimes(2);
  });

  it("claims concurrent duplicate deliveries before awaiting the deploy", async () => {
    let finish!: (queued: boolean) => void;
    vi.mocked(dispatchDeployHook).mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const first = delivery();
    await vi.waitFor(() => expect(dispatchDeployHook).toHaveBeenCalledTimes(1));
    expect((await delivery()).status).toBe(200);
    finish(true);
    expect((await first).status).toBe(202);
  });

  it("allows retries after dispatch failure without exposing backend errors", async () => {
    vi.mocked(dispatchDeployHook).mockRejectedValueOnce(new Error(hook.secret));
    const failed = await delivery();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain(hook.secret);
    expect((await delivery()).status).toBe(202);
  });

  it("ignores a hook disabled or changed during metadata lookup", async () => {
    vi.mocked(dispatchDeployHook).mockResolvedValueOnce(false);
    expect((await delivery()).status).toBe(200);
    expect((await delivery()).status).toBe(202);
  });

  it("rejects a service changed to an unmanaged compose", async () => {
    syncDeployHookSource(hook.serviceId, "services: {}");
    expect((await delivery()).status).toBe(404);
    expect(dispatchDeployHook).not.toHaveBeenCalled();
  });
});

describe("owner-only hook settings", () => {
  it("requires the hook owner before changing preview/fork settings or deleting a preview", async () => {
    userId = "other-owner";
    expect((await updatePreviewSettingsAction(hook.serviceId, { enabled: true, allowForks: true })).ok).toBe(false);
    expect((await deletePreviewAction(hook.serviceId, 12)).ok).toBe(false);
    expect(vi.mocked(request).mock.calls.some(([procedure]) => procedure === "user.createApiKey" || procedure === "compose.delete")).toBe(false);
  });

  it("defaults previews/forks off, encrypts opt-in access, hides credentials, and revokes on disable", async () => {
    hook = { ...hook, serviceId: "a-real-service-id-with-21-characters", token: "c".repeat(64) };
    saveDeployHook(hook);
    vi.stubEnv("SWITCHYARD_SESSION_SECRET", "local-test-secret");
    const original = vi.mocked(request).getMockImplementation()!;
    vi.mocked(request).mockImplementation(async (procedure, init) => {
      if (procedure === "auth/get-session") return { user: { id: userId }, session: { activeOrganizationId: "organization" } };
      if (procedure.startsWith("compose.one?")) return { composeFile, environment: { projectId: "project" } };
      if (procedure === "user.createApiKey") {
        expect((init?.body as { name: string }).name.length).toBeLessThanOrEqual(32);
        return { id: "automation-id", key: "automation-secret" };
      }
      if (procedure === "user.deleteApiKey") return true;
      return original(procedure, init);
    });
    expect(await getDeployHookAction(hook.serviceId)).toMatchObject({ ok: true, hook: { previewsEnabled: false, allowForks: false, previews: [] } });
    const result = await updatePreviewSettingsAction(hook.serviceId, { enabled: true, allowForks: false });
    expect(result).toMatchObject({ ok: true, hook: { previewsEnabled: true, allowForks: false } });
    expect(JSON.stringify(result)).not.toContain("automation");
    expect(findDeployHook(hook.serviceId)?.previewAccess?.sealedKey).not.toContain("automation-secret");
    expect(findDeployHook(hook.serviceId)?.previewAccess?.projectId).toBe("project");
    await updatePreviewSettingsAction(hook.serviceId, { enabled: true, allowForks: true });
    expect(vi.mocked(request).mock.calls.filter(([name]) => name === "user.createApiKey")).toHaveLength(1);
    expect(await updatePreviewSettingsAction(hook.serviceId, { enabled: false, allowForks: false })).toMatchObject({ ok: true, hook: { previewsEnabled: false } });
    expect(request).toHaveBeenCalledWith("user.deleteApiKey", { method: "POST", body: { apiKeyId: "automation-id" } });
    expect(findDeployHook(hook.serviceId)?.previewAccess).toBeUndefined();
  });

  it("never mints automation access without encryption or an enabled hook", async () => {
    vi.stubEnv("SWITCHYARD_SESSION_SECRET", "");
    expect((await updatePreviewSettingsAction(hook.serviceId, { enabled: true, allowForks: false })).ok).toBe(false);
    saveDeployHook({ ...hook, enabled: false });
    expect((await updatePreviewSettingsAction(hook.serviceId, { enabled: true, allowForks: false })).ok).toBe(false);
    expect(vi.mocked(request).mock.calls.some(([name]) => name === "user.createApiKey")).toBe(false);
  });
  it("only returns the view to an authenticated owner with service management access", async () => {
    const result = await getDeployHookAction(hook.serviceId);
    expect(result).toMatchObject({ ok: true, hook: { secret: hook.secret, path: `/api/hooks/deploy/${hook.token}` } });
    expect(JSON.stringify(result)).not.toContain("sealed-");
    expect(request).toHaveBeenCalledWith("compose.getDefaultCommand?composeId=compose-1");
    expect(findDeployHook(hook.serviceId)).not.toHaveProperty("sessionToken");
    expect(JSON.stringify(result)).not.toContain(hook.refreshToken);
  });

  it("rejects another account for reads and updates", async () => {
    userId = "other-owner";
    for (const operation of [getDeployHookAction(hook.serviceId), updateDeployHookAction(hook.serviceId, "regenerate")]) {
      const result = await operation;
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(hook.secret);
    }
    expect(findDeployHook(hook.serviceId)?.token).toBe(hook.token);
  });

  it("rejects missing sessions and service readers", async () => {
    vi.mocked(openSession).mockReturnValueOnce(null);
    expect((await getDeployHookAction(hook.serviceId)).ok).toBe(false);
    vi.mocked(request).mockImplementation(async (procedure) => {
      if (procedure === "auth/get-session") return { user: { id: userId } };
      if (procedure.startsWith("compose.one?")) return { composeFile, refreshToken: "rotated-native-token" };
      throw new Error(hook.secret);
    });
    const result = await updateDeployHookAction("new-service", "enable");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(hook.secret);
    expect(findDeployHook("new-service")).toBeNull();
  });

  it("creates server-generated credentials and preserves them across disable/enable", async () => {
    const created = await updateDeployHookAction("new-service", "enable");
    expect(created).toMatchObject({ ok: true, hook: { enabled: true, secret: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    const original = findDeployHook("new-service")!;
    expect(original.ownerId).toBe(userId);
    expect(original.secret).not.toBe(hook.secret);
    expect((await updateDeployHookAction("new-service", "disable"))).toMatchObject({ ok: true, hook: { enabled: false } });
    await updateDeployHookAction("new-service", "enable");
    expect(findDeployHook("new-service")).toMatchObject({ token: original.token, secret: original.secret, enabled: true });
  });

  it("regenerates both credentials while preserving disabled state", async () => {
    await updateDeployHookAction(hook.serviceId, "disable");
    expect(await updateDeployHookAction(hook.serviceId, "regenerate")).toMatchObject({ ok: true, hook: { enabled: false } });
    const rotated = findDeployHook(hook.serviceId)!;
    expect(rotated.secret).not.toBe(hook.secret);
    expect(rotated.token).not.toBe(hook.token);
    expect((await delivery()).status).toBe(404);
  });

  it("settings reads cannot restore disabled hooks or revoked credentials", async () => {
    await Promise.all([updateDeployHookAction(hook.serviceId, "disable"), getDeployHookAction(hook.serviceId)]);
    expect(findDeployHook(hook.serviceId)?.enabled).toBe(false);
    await Promise.all([updateDeployHookAction(hook.serviceId, "regenerate"), getDeployHookAction(hook.serviceId)]);
    expect(findDeployHook(hook.serviceId)?.token).not.toBe(hook.token);
    expect(findDeployHook(hook.serviceId)?.refreshToken).toBe("rotated-native-token");
  });

  it("rotates the native token and disables native deployments on Disable", async () => {
    await updateDeployHookAction(hook.serviceId, "disable");
    expect(request).toHaveBeenCalledWith("compose.refreshToken", { method: "POST", body: { composeId: hook.serviceId } });
    expect(request).toHaveBeenCalledWith("compose.update", { method: "POST", body: { composeId: hook.serviceId, autoDeploy: false } });
    expect(request).not.toHaveBeenCalledWith("compose.update", { method: "POST", body: { composeId: hook.serviceId, autoDeploy: true } });
  });

  it("serializes overlapping native token rotations", async () => {
    let rotations = 0;
    let inFlight = 0;
    const original = vi.mocked(request).getMockImplementation()!;
    vi.mocked(request).mockImplementation(async (procedure, init) => {
      if (procedure === "compose.refreshToken") {
        expect(inFlight).toBe(0);
        inFlight++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        rotations++;
        inFlight--;
      }
      return original(procedure, init);
    });
    await Promise.all([updateDeployHookAction(hook.serviceId, "enable"), updateDeployHookAction(hook.serviceId, "disable")]);
    expect(rotations).toBe(2);
    expect(findDeployHook(hook.serviceId)?.enabled).toBe(false);
  });

  it("fails closed if native token rotation fails", async () => {
    const original = vi.mocked(request).getMockImplementation()!;
    vi.mocked(request).mockImplementation(async (procedure, init) => {
      if (procedure === "compose.refreshToken") throw new Error(hook.refreshToken);
      return original(procedure, init);
    });
    const result = await updateDeployHookAction(hook.serviceId, "regenerate");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(hook.refreshToken);
    expect(findDeployHook(hook.serviceId)?.enabled).toBe(false);
  });
});
