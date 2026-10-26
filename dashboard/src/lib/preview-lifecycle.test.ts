import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./preview-access", () => ({ previewRequest: vi.fn() }));
vi.mock("./preview-cleanup", () => ({ cleanupPreviewContainers: vi.fn() }));
vi.mock("./deploy-hook-dispatch", () => ({ dispatchComposeHook: vi.fn(), dispatchDeployHook: vi.fn() }));
vi.mock("./repo-port", () => ({ fetchRepoExposedPorts: vi.fn().mockResolvedValue(["8080/tcp"]) }));

import { POST } from "@/app/api/hooks/deploy/[serviceToken]/route";
import { after } from "next/server";
import { dispatchComposeHook, dispatchDeployHook } from "./deploy-hook-dispatch";
import { findDeployHook, saveDeployHook, type DeployHookRecord } from "./deploy-hook-store";
import { previewRequest, type PreviewRequest } from "./preview-access";
import { cleanupPreviewContainers } from "./preview-cleanup";
import { deleteOwnedPreview, type PreviewCompose } from "./preview-lifecycle";
import { githubRepo, PREVIEW_LIMIT } from "./pr-previews";
import { parseManaged, repoStack } from "./managed-compose";
import { detectBuildPlan } from "./build-plan";
import { fetchRepoExposedPorts } from "./repo-port";

const repoUrl = "https://github.com/acme/web.git";
const sha = "a".repeat(40);
let directory: string;
let hook: DeployHookRecord;
let parent: PreviewCompose;
let services: PreviewCompose[];
let sequence: number;
let previewEnvironment: boolean;
let api: ReturnType<typeof vi.fn<PreviewRequest>>;

function payload(action = "opened", number = 12, headSha = sha, headRepo = repoUrl) {
  return {
    action, number, pull_request: {
      number, title: "Improve header", base: { repo: { clone_url: repoUrl } },
      head: { ref: "feature/header", sha: headSha, repo: { clone_url: headRepo } },
    },
  };
}

async function deliver(data: unknown = payload(), options: { event?: string; signature?: string; delivery?: string; body?: Buffer } = {}) {
  const body = options.body ?? Buffer.from(JSON.stringify(data));
  return POST(new Request("http://dashboard.test/api/hooks/deploy/test", {
    method: "POST", body: Buffer.from(body), headers: {
      "x-github-event": options.event ?? "pull_request",
      "x-hub-signature-256": options.signature ?? `sha256=${createHmac("sha256", hook.secret).update(body).digest("hex")}`,
      ...(options.delivery ? { "x-github-delivery": options.delivery } : {}),
    },
  }), { params: Promise.resolve({ serviceToken: hook.token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  sequence = 0;
  previewEnvironment = true;
  directory = mkdtempSync(path.join(tmpdir(), "switchyard-previews-"));
  vi.stubEnv("SWITCHYARD_DATA_DIR", directory);
  hook = {
    serviceId: "parent", ownerId: "owner", token: "a".repeat(64), secret: "b".repeat(64),
    enabled: true, refreshToken: "parent-token", repoUrl, branch: "main", previewsEnabled: true,
    allowForks: false, previewAccess: { id: "key-id", sealedKey: "encrypted", projectId: "project" },
  };
  saveDeployHook(hook);
  parent = {
    composeId: "parent", appName: "web-parent", name: "web", environmentId: "production", description: "Parent",
    environment: { projectId: "project" }, env: "PORT=8080\nDEMO=parent-value",
    refreshToken: "parent-token", composeFile: repoStack({ appName: "web-parent", repoUrl, branch: "main" }),
  };
  services = [parent];
  api = vi.fn<PreviewRequest>(async <T>(procedure: string, input?: unknown): Promise<T> => {
    const body = input as Record<string, unknown>;
    if (procedure.startsWith("project.one?")) return { environments: [
      { environmentId: "production", name: "production", compose: services.filter((item) => item.environmentId === "production") },
      ...(previewEnvironment ? [{ environmentId: "preview", name: "preview", compose: services.filter((item) => item.environmentId === "preview") }] : []),
    ] } as T;
    if (procedure.startsWith("compose.one?")) {
      const service = services.find((item) => item.composeId === procedure.split("=")[1]);
      if (!service) throw new Error("Missing service");
      return structuredClone(service) as T;
    }
    if (procedure === "compose.create") {
      const service = {
        ...body, composeId: `preview-${++sequence}`, appName: `preview-app-${sequence}`,
        environment: { projectId: "project" }, refreshToken: `preview-token-${sequence}`, composeFile: "", env: "", domains: [],
      } as unknown as PreviewCompose;
      services.push(service);
      return structuredClone(service) as T;
    }
    if (procedure === "domain.generateDomain") return `${body.appName}.127.0.0.1.traefik.me` as T;
    const service = services.find((item) => item.composeId === body?.composeId);
    if (procedure === "compose.update" || procedure === "compose.saveEnvironment") Object.assign(service!, body);
    else if (procedure === "domain.create") service!.domains!.push({ ...body, domainId: "domain-1" } as never);
    else if (procedure === "domain.update") {
      for (const item of services) for (const domain of item.domains ?? []) {
        if (domain.domainId === body.domainId) Object.assign(domain, body);
      }
    }
    else if (procedure === "compose.delete") services = services.filter((item) => item !== service);
    else if (procedure !== "user.deleteApiKey" && procedure !== "compose.cleanQueues") throw new Error("Unexpected API call");
    return {} as T;
  });
  vi.mocked(previewRequest).mockReturnValue(api as PreviewRequest);
  vi.mocked(dispatchComposeHook).mockResolvedValue();
  vi.mocked(cleanupPreviewContainers).mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const saved = () => findDeployHook(hook.serviceId)!;
const calls = (procedure: string) => api.mock.calls.filter(([name]) => name === procedure);

describe("signed PR lifecycle on the existing deploy hook", () => {
  it.each(["", "sha256=bad", `sha256=${"0".repeat(64)}`])("rejects invalid signatures before any lifecycle work (%s)", async (signature) => {
    expect((await deliver(payload(), { signature })).status).toBe(403);
    expect(api).not.toHaveBeenCalled();
  });

  it("checks the exact raw bytes and shares body size/UTF-8 limits", async () => {
    const signature = `sha256=${createHmac("sha256", hook.secret).update(JSON.stringify(payload())).digest("hex")}`;
    expect((await deliver(payload(), { signature, body: Buffer.from(JSON.stringify(payload()) + " ") })).status).toBe(403);
    expect((await deliver(null, { body: Buffer.alloc(1024 * 1024 + 1) })).status).toBe(413);
    expect((await deliver(null, { body: Buffer.from([0xff]) })).status).toBe(400);
    expect(api).not.toHaveBeenCalled();
  });

  it("times out a slow raw body after five seconds", async () => {
    vi.useFakeTimers();
    const request = new Request("http://dashboard.test", {
      method: "POST", body: new ReadableStream({ start() {} }), duplex: "half",
    } as RequestInit);
    const pending = POST(request, { params: Promise.resolve({ serviceToken: hook.token }) });
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).status).toBe(413);
  });

  it.each(["ping", "pull_request_target", "issues"])('ignores event "%s"', async (event) => {
    expect((await deliver(payload(), { event })).status).toBe(200);
    expect(api).not.toHaveBeenCalled();
    expect(dispatchDeployHook).not.toHaveBeenCalled();
  });

  it.each(["edited", "labeled", "ready_for_review"])("ignores PR action %s", async (action) => {
    expect((await deliver(payload(action))).status).toBe(200);
    expect(api).not.toHaveBeenCalled();
  });

  it("defaults off and never creates a service until explicitly enabled", async () => {
    saveDeployHook({ ...hook, previewsEnabled: undefined, allowForks: undefined });
    expect(await (await deliver()).json()).toEqual({ result: "PR previews disabled" });
    expect(api).not.toHaveBeenCalled();
  });

  it("creates one pinned preview in an existing preview environment, with copied env and its own URL", async () => {
    expect((await deliver()).status).toBe(202);
    expect(calls("compose.create")).toHaveLength(1);
    const child = services[1];
    expect(child).toMatchObject({ name: "web-pr-12", environmentId: "preview", env: parent.env });
    expect(child.composeFile).toContain(`${repoUrl}#${sha}`);
    expect(parseManaged(child.composeFile)).toMatchObject({ kind: "repo", branch: "feature/header", commit: sha,
      preview: { parentId: "parent", number: 12, title: "Improve header" } });
    expect(saved().previews?.[0].url).toMatch(/^http:\/\/preview-app-/);
    expect(dispatchComposeHook).toHaveBeenCalledExactlyOnceWith("preview-token-1", "feature/header", sha, "PR #12 · aaaaaaa · Improve header");
    expect(parent.env).toBe("PORT=8080\nDEMO=parent-value");
    expect(calls("compose.update")[0][1]).not.toHaveProperty("volumes");
  });

  it("uses the parent environment if no preview environment exists, without creating one", async () => {
    previewEnvironment = false;
    expect((await deliver()).status).toBe(202);
    expect(services[1].environmentId).toBe("production");
    expect(calls("environment.create")).toHaveLength(0);
  });

  it.each([
    ["node", { files: ["package.json"], contents: { "package.json": '{"scripts":{"start":"node server.js"}}' } }, 3000],
    ["python", { files: ["requirements.txt", "app.py"], contents: { "requirements.txt": "flask" } }, 8000],
    ["go", { files: ["go.mod"], contents: {} }, 8080],
    ["static", { files: ["index.html"], contents: {} }, 80],
  ] as const)("inherits the parent's %s recipe, port and build path through synchronize and close", async (kind, files, port) => {
    const plan = detectBuildPlan({ files: [...files.files], contents: files.contents });
    parent.composeFile = repoStack({ appName: parent.appName, repoUrl, branch: "main", subdirectory: "apps/web" }, plan);
    parent.env = "DEMO=parent-value";
    const original = parent.composeFile;
    expect((await deliver()).status).toBe(202);
    const child = services[1];
    expect(parseManaged(child.composeFile)).toMatchObject({
      buildKind: kind, buildPort: port, subdirectory: "apps/web", commit: sha,
      autoDomain: { port }, preview: { parentId: "parent", number: 12 },
    });
    expect(child.composeFile).toContain(`${repoUrl}#${sha}:apps/web`);
    const inline = (file: string) => file.match(/      dockerfile_inline: \|\n(?:        .*\n)+/)?.[0];
    expect(inline(original)).toBeDefined();
    expect(inline(child.composeFile)).toBe(inline(original));
    expect(child.domains?.[0].port).toBe(port);
    expect(fetchRepoExposedPorts).not.toHaveBeenCalled();

    parent.env = "PORT=9090";
    expect((await deliver(payload("synchronize", 12, "c".repeat(40)))).status).toBe(202);
    expect(calls("compose.create")).toHaveLength(1);
    expect(child.composeFile).toContain(`${repoUrl}#${"c".repeat(40)}:apps/web`);
    expect(inline(child.composeFile)).toBe(inline(original));
    expect(parseManaged(child.composeFile)).toMatchObject({ buildKind: kind, buildPort: port, autoDomain: { port: 9090 } });
    expect(child.domains?.[0].port).toBe(9090);
    expect((await deliver(payload("closed"))).status).toBe(202);
    expect(services).toEqual([parent]);
    expect(saved().previews).toEqual([]);
    expect(parent.composeFile).toBe(original);
  });

  it.each([undefined, "Dockerfile", "docker/Production"])("preserves Dockerfile builds (%s) and their port detection", async (dockerfile) => {
    parent.composeFile = repoStack({ appName: parent.appName, repoUrl, branch: "main", subdirectory: "apps/web", dockerfile });
    parent.env = "";
    expect((await deliver()).status).toBe(202);
    const child = services[1];
    const managed = parseManaged(child.composeFile);
    expect(managed).toMatchObject({ subdirectory: "apps/web", commit: sha });
    expect(managed).not.toHaveProperty("buildKind");
    expect(managed).not.toHaveProperty("buildPort");
    if (dockerfile) expect(managed).toHaveProperty("dockerfile", dockerfile);
    expect(child.composeFile).toContain(`${repoUrl}#${sha}:apps/web`);
    expect(child.composeFile).not.toContain("dockerfile_inline:");
    if (dockerfile === "docker/Production") expect(child.composeFile).toContain("      dockerfile: docker/Production\n");
    else expect(child.composeFile).not.toContain("      dockerfile:");
    expect(fetchRepoExposedPorts).toHaveBeenCalledWith(expect.objectContaining({ repoUrl, branch: sha, subdirectory: "apps/web", ...(dockerfile ? { dockerfile } : {}) }));
    expect(child.domains?.[0].port).toBe(8080);
    expect((await deliver(payload("closed"))).status).toBe(202);
    expect(services).toEqual([parent]);
  });

  it("rejects a missing generated recipe before creating a preview", async () => {
    parent.composeFile = parent.composeFile.replace("services:", "  buildKind: node\n  buildPort: 3000\nservices:");
    expect((await deliver()).status).toBe(503);
    expect(calls("compose.create")).toHaveLength(0);
    expect(dispatchComposeHook).not.toHaveBeenCalled();
  });

  it("updates the automatic URL port with parent env, preserving an explicit domain edit", async () => {
    await deliver();
    parent.env = "PORT=9090";
    expect((await deliver(payload("synchronize", 12, "c".repeat(40)))).status).toBe(202);
    expect(services[1].domains?.[0].port).toBe(9090);
    services[1].domains![0].port = 7070;
    parent.env = "PORT=8081";
    expect((await deliver(payload("synchronize", 12, "d".repeat(40)))).status).toBe(202);
    expect(services[1].domains?.[0].port).toBe(7070);
    expect((await deliver(payload("synchronize", 12, "e".repeat(40)))).status).toBe(202);
    expect(services[1].domains?.[0].port).toBe(7070);
    expect(calls("domain.update")).toHaveLength(1);
  });

  it("updates the same preview for synchronize and reopened; closed then reopened creates a fresh owned preview", async () => {
    await deliver();
    parent.env = "PORT=8080\nDEMO=updated";
    expect((await deliver(payload("synchronize", 12, "c".repeat(40)))).status).toBe(202);
    expect(services[1].env).toBe(parent.env);
    expect(services[1].composeFile).toContain(`#${"c".repeat(40)}`);
    expect((await deliver(payload("reopened", 12, "d".repeat(40)))).status).toBe(202);
    expect(calls("compose.create")).toHaveLength(1);
    await deliver(payload("closed"));
    expect((await deliver(payload("reopened", 12, "e".repeat(40)))).status).toBe(202);
    expect(calls("compose.create")).toHaveLength(2);
  });

  it("can reopen and close repeatedly at the same SHA without suppressing a new lifecycle", async () => {
    await deliver();
    for (let cycle = 0; cycle < 2; cycle++) {
      expect((await deliver(payload("closed"), { delivery: `close-${cycle}` })).status).toBe(202);
      expect((await deliver(payload("reopened"), { delivery: `reopen-${cycle}` })).status).toBe(202);
    }
    expect(calls("compose.create")).toHaveLength(3);
    expect(calls("compose.delete")).toHaveLength(2);
    expect((await deliver(payload("closed"), { delivery: "close-0" })).status).toBe(200);
    expect(saved().previews).toHaveLength(1);
  });

  it("gates forks using canonical repo identity, never an untrusted fork boolean", async () => {
    const fork = payload("opened", 12, sha, "https://github.com/contributor/web.git");
    expect(await (await deliver(fork)).json()).toMatchObject({ result: expect.stringContaining("fork previews disabled") });
    expect(api).not.toHaveBeenCalled();
    saveDeployHook({ ...saved(), allowForks: true });
    expect((await deliver(fork)).status).toBe(202);
    expect(services[1].composeFile).toContain("https://github.com/contributor/web.git#");
    expect(services[1].env).toBe(parent.env);
  });

  it.each(["http://127.0.0.1/repo", "https://github.com.evil.test/acme/web", "https://secret@github.com/acme/web", "https://github.com/acme/../web", "file:///repo"])("rejects unsafe head repo %s", async (repo) => {
    expect((await deliver(payload("opened", 12, sha, repo))).status).toBe(400);
    expect(api).not.toHaveBeenCalled();
  });

  it("rejects invalid base, SHA, branch, and number without backend access", async () => {
    const wrongBase = payload();
    wrongBase.pull_request.base.repo.clone_url = "https://github.com/another/repo";
    const badBranch = payload();
    badBranch.pull_request.head.ref = "main${ENV}";
    for (const data of [null, {}, { ...payload(), number: -1 }, { ...payload(), number: 13 }, wrongBase, badBranch,
      payload("opened", 12, "bad"), payload("opened", 12, "0".repeat(40))]) {
      expect((await deliver(data)).status).toBe(data && Object.keys(data).length === 0 ? 200 : 400);
    }
    expect(api).not.toHaveBeenCalled();
  });

  it("deduplicates delivery IDs and action+SHA (including after a module reload/60 seconds)", async () => {
    await deliver(payload(), { delivery: "delivery-1" });
    expect((await deliver(payload("synchronize", 12, "c".repeat(40)), { delivery: "delivery-1" })).status).toBe(200);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    const reloaded = await import("./deploy-hook-store");
    expect(reloaded.findDeployHook("parent")?.previews?.[0].lastAction).toBe(`opened:${sha}`);
    expect((await deliver(payload(), { delivery: "delivery-2" })).status).toBe(200);
    expect(dispatchComposeHook).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent deliveries, including cap reservations", async () => {
    const responses = await Promise.all(Array.from({ length: 7 }, (_, index) => deliver(payload("opened", index + 1))));
    expect(responses.map((res) => res.status)).toEqual([202, 202, 202, 202, 202, 429, 429]);
    expect(saved().previews).toHaveLength(PREVIEW_LIMIT);
    expect(await responses[5].text()).toContain("preview limit reached (5)");
    expect((await deliver(payload("synchronize", 1, "c".repeat(40)))).status).toBe(202);
    expect(calls("compose.create")).toHaveLength(5);
  });

  it("does not claim a same-name service or overwrite its env", async () => {
    services.push({ ...parent, composeId: "foreign", name: "web-pr-12", environmentId: "preview" });
    expect((await deliver()).status).toBe(503);
    expect(calls("compose.create")).toHaveLength(0);
    expect(calls("compose.update")).toHaveLength(0);
  });

  it.each(["project", "source", "remote", "nested"])("fails closed after a parent %s change", async (change) => {
    if (change === "project") parent.environment.projectId = "other";
    if (change === "source") parent.composeFile = "services: {}";
    if (change === "remote") parent.serverId = "remote";
    if (change === "nested") parent.composeFile = repoStack({ appName: "web", repoUrl, branch: "main", preview: { parentId: "x", number: 1, marker: "x", title: "x" } });
    expect((await deliver()).status).toBe(503);
    expect(calls("compose.create")).toHaveLength(0);
  });

  it("retries partial failure without another create or leaked backend errors", async () => {
    vi.mocked(dispatchComposeHook).mockRejectedValueOnce(new Error("secret backend detail"));
    const failed = await deliver();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("secret backend detail");
    expect((await deliver()).status).toBe(202);
    expect(calls("compose.create")).toHaveLength(1);
  });

  it("preserves a concurrent source edit and cancels the stale preview dispatch", async () => {
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (procedure, body) => {
      const result = await original(procedure, body);
      if (procedure === "compose.saveEnvironment") saveDeployHook({ ...saved(), branch: "release" });
      return result;
    });
    expect((await deliver()).status).toBe(503);
    expect(saved().branch).toBe("release");
    expect(dispatchComposeHook).not.toHaveBeenCalled();
  });

  it("escapes Compose interpolation in titles while retaining the visible title", async () => {
    const data = payload();
    data.pull_request.title = 'Fix ${PORT} and "quotes"';
    expect((await deliver(data)).status).toBe(202);
    expect(services[1].composeFile).toContain("$${PORT}");
    expect(parseManaged(services[1].composeFile)).toMatchObject({ preview: { title: data.pull_request.title } });
  });

  it("recovers a lost create response by its persisted marker", async () => {
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (procedure, body) => {
      const result = await original(procedure, body);
      if (procedure === "compose.create") throw new Error("response lost");
      return result;
    });
    expect((await deliver()).status).toBe(503);
    expect(saved().previews?.[0].serviceId).toBeUndefined();
    expect((await deliver()).status).toBe(202);
    expect(calls("compose.create")).toHaveLength(1);
  });

  it("does not recreate an ambiguous failed reservation", async () => {
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (procedure, body) => {
      if (procedure === "compose.create") throw new Error("request failed");
      return original(procedure, body);
    });
    expect((await deliver()).status).toBe(503);
    expect((await deliver()).status).toBe(503);
    expect(calls("compose.create")).toHaveLength(1);
    await deleteOwnedPreview(saved(), 12, api as PreviewRequest);
    expect(saved().previews).toEqual([]);
  });
});

describe("owned cleanup", () => {
  it("defers close until the active build ends, then removes its eventual container", async () => {
    await deliver();
    services[1].composeStatus = "running";
    expect(await (await deliver(payload("closed"))).json()).toMatchObject({ result: "preview cleanup queued; waiting for current build" });
    expect(saved().previews?.[0].deleting).toBe(true);
    expect(calls("compose.cleanQueues")).toHaveLength(1);
    expect(calls("compose.delete")).toHaveLength(0);
    expect(cleanupPreviewContainers).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
    services[1].composeStatus = "done";
    // Execute the registered after-response work with its first timer elapsed.
    const work = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    const pending = work();
    await pending;
    expect(calls("compose.delete")).toHaveLength(1);
    expect(saved().previews).toEqual([]);
  });
  it.each([true, false])("cleans merged=%s, even without a head repo and after disabling previews/forks", async (merged) => {
    await deliver();
    saveDeployHook({ ...saved(), previewsEnabled: false, allowForks: false });
    const data = payload("closed");
    const closed = { ...data, pull_request: { ...data.pull_request, head: null, merged } };
    expect((await deliver(closed)).status).toBe(202);
    expect(calls("compose.delete")).toEqual([["compose.delete", { composeId: "preview-1", deleteVolumes: true }]]);
    expect(cleanupPreviewContainers).toHaveBeenCalledWith(expect.objectContaining({ marker: expect.any(String), appName: "preview-app-1" }));
    expect(services).toEqual([parent]);
    expect(saved().previews).toEqual([]);
    expect(calls("user.deleteApiKey")).toHaveLength(1);
    expect((await deliver(closed)).status).toBe(200);
    expect(calls("compose.delete")).toHaveLength(1);
  });

  it.each(["name", "description", "appName", "environmentId", "project", "remote"])("never deletes a preview whose %s no longer matches", async (field) => {
    await deliver();
    if (field === "project") services[1].environment.projectId = "other";
    else if (field === "remote") services[1].serverId = "other";
    else Object.assign(services[1], { [field]: "other" });
    const result = await deliver(payload("closed"));
    expect(result.status).toBe(503);
    expect(calls("compose.delete")).toHaveLength(0);
    expect(cleanupPreviewContainers).not.toHaveBeenCalled();
  });

  it("never deletes the parent, even if the stored service ID points at it", async () => {
    await deliver();
    const current = saved();
    Object.assign(current.previews![0], { serviceId: "parent", appName: parent.appName, environmentId: "production" });
    saveDeployHook(current);
    expect((await deliver(payload("closed"))).status).toBe(503);
    expect(calls("compose.delete")).toHaveLength(0);
    expect(cleanupPreviewContainers).not.toHaveBeenCalled();
  });

  it.each([false, true])("never deletes an edited preview stack that could mount foreign volumes (auto-detected=%s)", async (detected) => {
    if (detected) parent.composeFile = repoStack({ appName: parent.appName, repoUrl, branch: "main" },
      detectBuildPlan({ files: ["index.html"], contents: {} }));
    await deliver();
    services[1].composeFile += "\nvolumes:\n  shared:\n    name: parent-data\n";
    expect((await deliver(payload("closed"))).status).toBe(503);
    expect(calls("compose.delete")).toHaveLength(0);
    expect(cleanupPreviewContainers).not.toHaveBeenCalled();
  });

  it("retries Docker cleanup after Dokploy already removed its row", async () => {
    await deliver();
    vi.mocked(cleanupPreviewContainers).mockRejectedValueOnce(new Error("daemon unavailable"));
    expect((await deliver(payload("closed"))).status).toBe(503);
    expect(saved().previews?.[0].deleting).toBe(true);
    expect((await deliver(payload("synchronize", 12, "c".repeat(40)))).status).toBe(503);
    expect((await deliver(payload("closed"))).status).toBe(202);
    expect(saved().previews).toEqual([]);
    expect(calls("compose.delete")).toHaveLength(1);
  });

  it("ignores unknown PRs without touching matching names", async () => {
    services.push({ ...parent, composeId: "foreign", name: "web-pr-12" });
    expect((await deliver(payload("closed"))).status).toBe(200);
    expect(api).not.toHaveBeenCalled();
  });
});

it("normalizes GitHub repository identity", () => {
  expect(githubRepo("https://github.com/Acme/Web.git/")).toBe("acme/web");
  expect(githubRepo("https://github.com/acme/web")).toBe("acme/web");
});
