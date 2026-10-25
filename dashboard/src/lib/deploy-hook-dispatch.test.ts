import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./git-remote", () => ({ resolveRepoCommit: vi.fn() }));

import { resolveRepoCommit } from "./git-remote";
import { dispatchDeployHook } from "./deploy-hook-dispatch";
import { saveDeployHook, type DeployHookRecord } from "./deploy-hook-store";

let directory: string;
const sha = "a1b2c3d" + "0".repeat(33);
const hook: DeployHookRecord = {
  serviceId: "service-1", ownerId: "owner-1", enabled: true, token: "a".repeat(64), secret: "b".repeat(64),
  refreshToken: "native-token", repoUrl: "https://github.com/example/web", branch: "main",
};

beforeEach(() => {
  vi.resetAllMocks();
  directory = mkdtempSync(path.join(tmpdir(), "switchyard-hook-dispatch-"));
  vi.stubEnv("SWITCHYARD_DATA_DIR", directory);
  vi.stubEnv("DOKPLOY_URL", "http://127.0.0.1:3000");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Compose deployed successfully" })));
  vi.mocked(resolveRepoCommit).mockResolvedValue({ sha, headline: "Fix header" });
  saveDeployHook(hook);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(directory, { force: true, recursive: true });
});

describe("native compose webhook dispatch", () => {
  it("sends resolved labels to the internal service endpoint without user credentials", async () => {
    expect(await dispatchDeployHook(hook)).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:3000/api/deploy/compose/native-token");
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
    expect(init?.headers).toEqual({ "Content-Type": "application/json", "X-GitHub-Event": "push" });
    expect(JSON.parse(String(init?.body))).toEqual({
      ref: "refs/heads/main", head_commit: { id: sha, message: "Deploy a1b2c3d · Fix header" },
    });
    expect(resolveRepoCommit).toHaveBeenCalledWith(hook.repoUrl, hook.branch);
  });

  it("still dispatches when optional commit lookup fails", async () => {
    vi.mocked(resolveRepoCommit).mockRejectedValue(new Error("unavailable"));
    expect(await dispatchDeployHook(hook)).toBe(true);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).head_commit.message).toBe("Deploy on push");
  });

  it.each([
    { enabled: false }, { refreshToken: "new-native-token" }, { branch: "release" },
    { repoUrl: "https://github.com/example/other" }, { token: "c".repeat(64) },
  ])("cancels dispatch after a concurrent hook change (%j)", async (patch) => {
    vi.mocked(resolveRepoCommit).mockImplementation(async () => {
      saveDeployHook({ ...hook, ...patch });
      return { sha };
    });
    expect(await dispatchDeployHook(hook)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([301, 400, 403, 404, 500])("does not acknowledge native rejection %s", async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
    await expect(dispatchDeployHook(hook)).rejects.toThrow("Deploy webhook unavailable");
  });
});
