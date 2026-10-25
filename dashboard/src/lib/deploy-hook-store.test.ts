import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { repoStack } from "./managed-compose";

import {
  claimDeployHook, findDeployHook, releaseDeployHook, resolveDeployHook, saveDeployHook, syncDeployHookSource,
  type DeployHookRecord,
} from "./deploy-hook-store";

const hook: DeployHookRecord = {
  serviceId: "service-a", ownerId: "owner-a", token: "a".repeat(64), secret: "b".repeat(64),
  enabled: true, refreshToken: "native-compose-token", repoUrl: "https://github.com/example/web", branch: "main",
};

let directory: string;
let file: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "switchyard-hooks-test-"));
  file = path.join(directory, "deploy-hooks.json");
  vi.stubEnv("SWITCHYARD_DATA_DIR", directory);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("persistent deploy hook configuration", () => {
  it("resolves tokens to the right service after a module reload", async () => {
    expect(findDeployHook(hook.serviceId)).toBeNull();
    saveDeployHook(hook);
    vi.resetModules();
    const reloaded = await import("./deploy-hook-store");
    expect(reloaded.resolveDeployHook(hook.token)?.serviceId).toBe(hook.serviceId);
    expect(reloaded.findDeployHook(hook.serviceId)?.secret).toBe(hook.secret);
    expect(reloaded.resolveDeployHook("unknown-token")).toBeNull();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
  });

  it("keeps only service credentials and synchronizes source edits", () => {
    saveDeployHook(hook);
    expect(fs.readFileSync(file, "utf8")).not.toMatch(/sessionToken|dokployCookie|expiresAt/);
    syncDeployHookSource(hook.serviceId, repoStack({ appName: "web", repoUrl: hook.repoUrl, branch: "release" }));
    expect(findDeployHook(hook.serviceId)?.branch).toBe("release");
    syncDeployHookSource(hook.serviceId, "services: {}");
    expect(resolveDeployHook(hook.token)).toBeNull();
  });

  it("rejects configurations containing user credentials", () => {
    expect(() => saveDeployHook({ ...hook, sessionToken: "sealed" } as DeployHookRecord)).toThrow();
    expect(() => saveDeployHook({ ...hook, dokployCookie: "cookie" } as DeployHookRecord)).toThrow();
  });

  it("disables token resolution without discarding owner configuration", () => {
    saveDeployHook({ ...hook, enabled: false });
    expect(resolveDeployHook(hook.token)).toBeNull();
    expect(findDeployHook(hook.serviceId)?.enabled).toBe(false);
    expect(claimDeployHook(hook.token, "delivery", 1_000)).toBe(false);
  });

  it("invalidates the old token and clears debounce when regenerated", () => {
    saveDeployHook(hook);
    expect(claimDeployHook(hook.token, "delivery", 1_000)).toBe(true);
    const rotated = { ...hook, token: "c".repeat(64), secret: "d".repeat(64) };
    saveDeployHook(rotated);
    expect(resolveDeployHook(hook.token)).toBeNull();
    expect(claimDeployHook(hook.token, "delivery", 1_001)).toBe(false);
    expect(resolveDeployHook(rotated.token)?.secret).toBe(rotated.secret);
    expect(claimDeployHook(rotated.token, "delivery", 1_001)).toBe(true);
  });

  it("rejects a token assigned to another service", () => {
    saveDeployHook(hook);
    expect(() => saveDeployHook({ ...hook, serviceId: "service-b" })).toThrow("Invalid deploy hook configuration.");
    expect(resolveDeployHook(hook.token)?.serviceId).toBe(hook.serviceId);
  });

  it("refuses to transfer an existing service hook to another owner", () => {
    saveDeployHook(hook);
    expect(() => saveDeployHook({ ...hook, ownerId: "owner-b", token: "c".repeat(64) }))
      .toThrow("Invalid deploy hook configuration.");
    expect(findDeployHook(hook.serviceId)?.ownerId).toBe(hook.ownerId);
    expect(resolveDeployHook(hook.token)?.serviceId).toBe(hook.serviceId);
  });

  it("rejects malformed tokens before accessing persisted configuration", () => {
    fs.writeFileSync(file, "broken json");
    expect(resolveDeployHook("short-token")).toBeNull();
    expect(resolveDeployHook("g".repeat(64))).toBeNull();
    expect(resolveDeployHook("a".repeat(65))).toBeNull();
  });

  it.each(["broken json", "{}", "[{}]", JSON.stringify([{ ...hook, enabled: "true" }]),
    JSON.stringify([hook, hook]), JSON.stringify([{ ...hook, recent: [{ key: "x", at: "yesterday" }] }])])(
    "fails closed on corrupt configuration", (contents) => {
      fs.writeFileSync(file, contents);
      expect(() => resolveDeployHook(hook.token)).toThrow("Deploy hook storage is unavailable.");
      expect(() => saveDeployHook(hook)).toThrow("Deploy hook storage is unavailable.");
      expect(fs.readFileSync(file, "utf8")).toBe(contents);
    },
  );

  it("fails closed when persistence fails and preserves the previous configuration", () => {
    saveDeployHook(hook);
    const original = fs.readFileSync(file, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("write failed"); });
    expect(() => saveDeployHook({ ...hook, enabled: false })).toThrow("Deploy hook storage is unavailable.");
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    expect(fs.readdirSync(directory)).toEqual(["deploy-hooks.json"]);
  });
});

describe("persisted push debounce", () => {
  beforeEach(() => saveDeployHook(hook));

  it("deduplicates A/B/A within a minute and accepts A at expiry", () => {
    expect(claimDeployHook(hook.token, "A", 1_000)).toBe(true);
    expect(claimDeployHook(hook.token, "B", 1_001)).toBe(true);
    expect(claimDeployHook(hook.token, "A", 1_002)).toBe(false);
    expect(claimDeployHook(hook.token, "A", 60_999)).toBe(false);
    expect(claimDeployHook(hook.token, "A", 61_000)).toBe(true);
  });

  it("survives a reload and stale settings saves", async () => {
    expect(claimDeployHook(hook.token, "A", 1_000)).toBe(true);
    saveDeployHook({ ...hook, recent: [] });
    vi.resetModules();
    const reloaded = await import("./deploy-hook-store");
    expect(reloaded.claimDeployHook(hook.token, "A", 1_001)).toBe(false);
  });

  it("releases a failed dispatch for retry without releasing another delivery", () => {
    expect(claimDeployHook(hook.token, "A", 1_000)).toBe(true);
    expect(claimDeployHook(hook.token, "B", 1_001)).toBe(true);
    releaseDeployHook(hook.token, "A");
    expect(claimDeployHook(hook.token, "A", 1_002)).toBe(true);
    expect(claimDeployHook(hook.token, "B", 1_003)).toBe(false);
  });

  it("keeps services isolated", () => {
    const other = { ...hook, serviceId: "service-b", token: "c".repeat(64) };
    saveDeployHook(other);
    expect(claimDeployHook(hook.token, "A", 1_000)).toBe(true);
    expect(claimDeployHook(other.token, "A", 1_000)).toBe(true);
    releaseDeployHook(other.token, "A");
    expect(claimDeployHook(hook.token, "A", 1_001)).toBe(false);
    expect(resolveDeployHook(other.token)?.serviceId).toBe(other.serviceId);
  });

  it("bounds retained deliveries without evicting protected identities", () => {
    for (let index = 0; index < 128; index++) {
      expect(claimDeployHook(hook.token, String(index), 1_000)).toBe(true);
    }
    expect(claimDeployHook(hook.token, "overflow", 1_001)).toBe(false);
    expect(claimDeployHook(hook.token, "0", 1_001)).toBe(false);
    expect(findDeployHook(hook.serviceId)?.recent).toHaveLength(128);
    expect(claimDeployHook(hook.token, "new", 61_000)).toBe(true);
    expect(findDeployHook(hook.serviceId)?.recent).toHaveLength(1);
  });

  it("never reports a claim as accepted when its persistence fails", () => {
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("write failed"); });
    expect(() => claimDeployHook(hook.token, "A", 1_000)).toThrow("Deploy hook storage is unavailable.");
    expect(findDeployHook(hook.serviceId)?.recent).toEqual([]);
  });
});
