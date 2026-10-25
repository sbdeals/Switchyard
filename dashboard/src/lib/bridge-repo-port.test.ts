import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const background = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => background.push(fn) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard-session",
  openSession: () => ({ dokployCookie: "dokploy-session=test" }),
}));
vi.mock("./docker", () => ({ inspectImageExposedPorts: vi.fn(), snapshotComposeAppImage: vi.fn(), verifyComposeAppImage: vi.fn(), pruneComposeAppImages: vi.fn() }));

import { composeAction, deployBridgeRepo, saveServiceEnv } from "./dokploy";
import { inspectImageExposedPorts, pruneComposeAppImages, snapshotComposeAppImage } from "./docker";
import { parseManaged, repoSnapshotTag, rewriteManagedApp, writeManagedMeta } from "./managed-compose";
import { AUTOMATIC_PORT_FIXUP_TITLE } from "./bridge-repo-release";
import { saveComposeFileAction, updateDomainAction } from "@/app/actions";

const host = "repo-test.203.0.113.10.traefik.me";
const source = { repoUrl: "http://192.0.2.10:8081/test.git", branch: "main" };
let detail: {
  appName: string;
  composeFile: string;
  composeStatus: string;
  env: string;
  deployments: { deploymentId: string; status: string; title?: string; createdAt?: string }[];
  domains: { domainId: string; host: string; port: number; serviceName: string }[];
};
let requests: { procedure: string; body: Record<string, unknown> }[];
let deployedFiles: string[];
let finishFixup: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("SWITCHYARD_HOST_IP", "203.0.113.10");
  vi.stubEnv("BRIDGE_REPO_PORT_POLL_MS", "10");
  vi.stubEnv("BRIDGE_REPO_PORT_TIMEOUT_MS", "100");
  vi.stubEnv("BRIDGE_REPO_PORT_FIXUP_TIMEOUT_MS", "500");
  background.length = 0;
  detail = { appName: "repo-test", composeFile: "", composeStatus: "idle", env: "", deployments: [], domains: [] };
  requests = [];
  deployedFiles = [];
  finishFixup = true;
  vi.mocked(snapshotComposeAppImage).mockResolvedValue(undefined);
  vi.mocked(inspectImageExposedPorts).mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (new URL(url).hostname === "raw.githubusercontent.com") return new Response("FROM alpine\nEXPOSE 80/tcp");
    const procedure = new URL(url).pathname.replace("/api/", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ procedure, body });
    switch (procedure) {
      case "compose.create": return Response.json({ composeId: "compose-1", appName: detail.appName });
      case "compose.one": return Response.json(detail);
      case "compose.update":
        if (body.composeFile) detail.composeFile = body.composeFile;
        return Response.json({});
      case "compose.saveEnvironment":
        detail.env = body.env;
        return Response.json({});
      case "compose.stop": return Response.json({});
      case "domain.generateDomain": return Response.json(host);
      case "domain.create":
        detail.domains.push({ domainId: "domain-1", ...body });
        return Response.json({});
      case "domain.update":
        detail.domains = detail.domains.map((domain) => ({ ...domain, ...body }));
        return Response.json({});
      case "compose.deploy":
        deployedFiles.push(detail.composeFile);
        detail.composeStatus = body.title === AUTOMATIC_PORT_FIXUP_TITLE && finishFixup ? "done" : "running";
        detail.deployments.push({ deploymentId: `deploy-${detail.deployments.length + 1}`, status: detail.composeStatus, title: body.title, createdAt: new Date().toISOString() });
        return Response.json({});
      default: throw new Error(`Unexpected procedure: ${procedure}`);
    }
  }));
});

afterEach(async () => {
  // Drain callbacks that a test did not run, including their bounded timers.
  const pending = background.map((fn) => fn());
  await vi.runAllTimersAsync();
  await Promise.all(pending);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const deployments = () => requests.filter(({ procedure }) => procedure === "compose.deploy");
const updates = () => requests.filter(({ procedure }) => procedure === "domain.update");
function finishBuild(port = 80) {
  detail.composeStatus = "done";
  detail.deployments[0].status = "done";
  vi.mocked(inspectImageExposedPorts).mockResolvedValue([`${port}/tcp`]);
}
async function runWatcher() {
  const pending = background[0]();
  await vi.advanceTimersByTimeAsync(10);
  await pending;
}

describe("first repo deployment port", () => {
  it("uses the public Dockerfile's port 80 on the first deploy and needs no follow-up", async () => {
    await deployBridgeRepo("repo", { ...source, repoUrl: "https://github.com/example/repo" }, "env-1");
    expect(detail.domains[0].port).toBe(80);
    expect(deployments()).toHaveLength(1);
    finishBuild();
    await runWatcher();
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it.each([80, 8080])("treats the automatic port %i fix-up as the same release, saving it only before an explicit redeploy", async (port) => {
    await deployBridgeRepo("repo", source, "env-1");
    expect(detail.domains[0].port).toBe(3000);
    expect(background).toHaveLength(1);
    finishBuild(port);
    await runWatcher();
    expect(detail.domains[0].port).toBe(port);
    expect(updates()).toHaveLength(1);
    expect(deployments()).toHaveLength(2);
    expect(deployments()[0].body).toEqual({ composeId: "compose-1" });
    expect(deployments()[1].body).toEqual({
      composeId: "compose-1",
      title: AUTOMATIC_PORT_FIXUP_TITLE,
      description: `Same release as the first deploy: applies the detected port ${port} to the public URL. No rollback entry is recorded.`,
    });
    const releaseImage = vi.mocked(snapshotComposeAppImage).mock.calls[0][1];
    expect(snapshotComposeAppImage).toHaveBeenCalledExactlyOnceWith(detail.appName, releaseImage);
    expect(inspectImageExposedPorts).toHaveBeenCalledWith(releaseImage);
    expect(deployedFiles[1]).not.toMatch(/^    build:/m);
    expect(deployedFiles[1]).toContain(`    image: ${releaseImage}\n    pull_policy: never\n`);
    expect(parseManaged(deployedFiles[1])).toMatchObject({ pinnedTag: releaseImage, autoDomain: { host, port } });
    const fixed = parseManaged(detail.composeFile);
    expect(fixed).toMatchObject({ kind: "repo", image: `${detail.appName}-app:latest`, autoDomain: { host, port } });
    if (fixed?.kind !== "repo") throw new Error("Expected managed repo metadata");
    expect(fixed.history ?? []).toEqual([]);
    expect(fixed).not.toHaveProperty("pinnedTag");
    expect(detail.composeFile).toContain("    build:\n");
    expect(detail.composeFile).toContain(`${source.repoUrl}#main`);
    expect(detail.composeFile).not.toContain("pull_policy:");
    expect(pruneComposeAppImages).toHaveBeenCalledWith(detail.appName, [releaseImage]);
    vi.mocked(snapshotComposeAppImage).mockClear();
    await background[0](); // duplicate callback cannot submit another deployment
    detail.composeStatus = "done"; detail.deployments.forEach((d) => { d.status = "done"; }); // integration (#53): explicit deploys wait for the follow-up
    await composeAction("compose-1", "deploy");
    expect(updates()).toHaveLength(1);
    expect(deployments()).toHaveLength(3); // only the explicit user request
    expect(deployments()[2].body).toEqual({ composeId: "compose-1" });
    const redeployed = parseManaged(detail.composeFile);
    expect(redeployed).toMatchObject({ kind: "repo", autoDomain: { host, port } });
    if (redeployed?.kind !== "repo") throw new Error("Expected managed repo metadata");
    expect(redeployed.history).toHaveLength(1);
    expect(snapshotComposeAppImage).toHaveBeenCalledExactlyOnceWith(detail.appName, redeployed.history![0].image);
    expect(deployedFiles[2]).toContain("    build:\n");
    expect(deployedFiles[2]).not.toContain("pull_policy:");
    expect(redeployed).not.toHaveProperty("pinnedTag");
  });

  it("skips the fix-up when the first build's image cannot be pinned", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    const original = detail.composeFile;
    vi.mocked(snapshotComposeAppImage).mockRejectedValueOnce(new Error("sensitive Docker failure details"));
    await runWatcher();
    expect(deployments()).toHaveLength(1);
    expect(updates()).toHaveLength(0);
    expect(detail.composeFile).toBe(original);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Automatic port fix-up skipped for compose-1: the first build's image could not be pinned. Redeploy to retry.");
  });

  it("detects the port from the first build's pin even if the mutable image tag changes", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    vi.mocked(inspectImageExposedPorts).mockImplementation(async (image) =>
      image.includes(":sy-") ? ["80/tcp"] : ["8080/tcp"]);
    await runWatcher();
    const releaseImage = vi.mocked(snapshotComposeAppImage).mock.calls[0][1];
    expect(deployedFiles[1]).toContain(`    image: ${releaseImage}\n    pull_policy: never\n`);
    expect(detail.domains[0].port).toBe(80);
  });

  it.each(["done", "error"])("keeps the image pinned through a delayed queue until the fix-up is %s", async (status) => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const fetchApi = vi.mocked(fetch).getMockImplementation()!;
    let startWorker!: () => Promise<Response>;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/compose.deploy")) {
        startWorker = () => Promise.resolve(fetchApi(input, init));
        return Response.json({}); // queued; no new record or running status yet
      }
      return fetchApi(input, init);
    });
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(150); // past the detection deadline
    const pinnedCompose = detail.composeFile;
    expect(pinnedCompose).not.toMatch(/^    build:/m);
    expect(pruneComposeAppImages).not.toHaveBeenCalled();
    expect(detail.deployments).toHaveLength(1);
    await startWorker(); // worker reads the stored file only now
    await vi.advanceTimersByTimeAsync(10);
    expect(deployedFiles[1]).toBe(pinnedCompose);
    expect(detail.composeFile).toBe(pinnedCompose);
    detail.deployments[1].status = status;
    detail.composeStatus = status;
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(detail.composeFile).toContain("    build:\n");
    expect(parseManaged(detail.composeFile)).toMatchObject({ autoDomain: { host, port: 80 } });
    expect(parseManaged(detail.composeFile)).not.toHaveProperty("pinnedTag");
    expect(pruneComposeAppImages).toHaveBeenCalledOnce();
  });

  it.each([404, 400])("stops without restoring when the compose is deleted during the wait (%i)", async (status) => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    const writes = requests.filter(({ procedure }) => procedure === "compose.update").length;
    const fetchApi = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).includes("/compose.one?")
        ? Promise.resolve(new Response("Compose not found", { status })) : fetchApi(input, init));
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(requests.filter(({ procedure }) => procedure === "compose.update")).toHaveLength(writes);
    expect(pruneComposeAppImages).toHaveBeenCalledExactlyOnceWith(
      detail.appName, [vi.mocked(snapshotComposeAppImage).mock.calls[0][1]]);
  });

  it.each([false, true])("caps cleanup and restores once only if the pinned compose is unchanged (edited: %s)", async (edited) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("BRIDGE_REPO_PORT_FIXUP_TIMEOUT_MS", "30");
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    if (edited) detail.composeFile += "# direct edit\n";
    const pinnedCompose = detail.composeFile;
    const writes = requests.filter(({ procedure }) => procedure === "compose.update").length;
    await vi.advanceTimersByTimeAsync(29);
    expect(detail.composeFile).toBe(pinnedCompose);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(requests.filter(({ procedure }) => procedure === "compose.update")).toHaveLength(writes + (edited ? 0 : 1));
    if (edited) expect(detail.composeFile).toBe(pinnedCompose);
    else {
      expect(detail.composeFile).toContain("    build:\n");
      expect(parseManaged(detail.composeFile)).toMatchObject({ autoDomain: { host, port: 80 } });
      expect(parseManaged(detail.composeFile)).not.toHaveProperty("pinnedTag");
    }
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Automatic port fix-up for compose-1: cleanup wait limit reached; restoring the build compose if unchanged and retaining the temporary image tag.");
    expect(pruneComposeAppImages).not.toHaveBeenCalled(); // the queued/running deploy may still need it
  });

  it("returns at the cleanup cap and retains the tag if Dokploy stays unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("BRIDGE_REPO_PORT_FIXUP_TIMEOUT_MS", "30");
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    const pinnedCompose = detail.composeFile;
    vi.mocked(fetch).mockImplementation(async () => new Response("Unavailable", { status: 503 }));
    await vi.advanceTimersByTimeAsync(30);
    await pending;
    expect(detail.composeFile).toBe(pinnedCompose);
    expect(pruneComposeAppImages).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2); // one request failure notice, one cap notice
  });

  it("restores and stops when a newer user deployment supersedes the running fix-up", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    const writes = requests.filter(({ procedure }) => procedure === "compose.update").length;
    detail.deployments.unshift({
      deploymentId: "user-redeploy", title: "Manual deployment", status: "running",
      createdAt: new Date(Date.now() + 1).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(requests.filter(({ procedure }) => procedure === "compose.update")).toHaveLength(writes + 1);
    expect(detail.composeFile).toContain("    build:\n");
    expect(parseManaged(detail.composeFile)).not.toHaveProperty("pinnedTag");
    expect(pruneComposeAppImages).not.toHaveBeenCalled(); // either deployment may still need it
  });

  it("does not mistake an older deployment for one that supersedes the fix-up", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    const pinnedCompose = detail.composeFile;
    detail.deployments.unshift({
      deploymentId: "older-deploy", title: "Manual deployment", status: "done",
      createdAt: new Date(Date.now() - 1).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(detail.composeFile).toBe(pinnedCompose);
    expect(pruneComposeAppImages).not.toHaveBeenCalled();
    detail.deployments.find((d) => d.title === AUTOMATIC_PORT_FIXUP_TITLE)!.status = "done";
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(detail.composeFile).toContain("    build:\n");
    expect(pruneComposeAppImages).toHaveBeenCalledOnce();
  });

  it.each([false, true])("protects rollback history when choosing and pruning the temporary tag (collision: %s)", async (collision) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    const managed = parseManaged(detail.composeFile);
    if (managed?.kind !== "repo") throw new Error("Expected managed repo metadata");
    const timestamp = new Date(Date.now() + (collision ? 10 : -10)).toISOString();
    const history = [{ timestamp, image: repoSnapshotTag(detail.appName, timestamp) }];
    detail.composeFile = writeManagedMeta(detail.composeFile, { ...managed, history });
    await runWatcher();
    if (collision) {
      expect(snapshotComposeAppImage).not.toHaveBeenCalled();
      expect(pruneComposeAppImages).not.toHaveBeenCalled();
      expect(deployments()).toHaveLength(1);
    } else {
      const image = vi.mocked(snapshotComposeAppImage).mock.calls[0][1];
      expect(image).not.toBe(history[0].image);
      expect(pruneComposeAppImages).toHaveBeenCalledExactlyOnceWith(detail.appName, [image]);
    }
    expect(parseManaged(detail.composeFile)).toMatchObject({ history });
  });

  it("keeps a temporary tag added to rollback history while the fix-up was running", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    const managed = parseManaged(detail.composeFile);
    if (managed?.kind !== "repo") throw new Error("Expected managed repo metadata");
    const history = [{ timestamp: new Date().toISOString(), image: managed.image }];
    delete managed.pinnedTag;
    detail.composeFile = rewriteManagedApp(detail.composeFile, detail.appName, { ...managed, history });
    detail.deployments[1].status = "done";
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(detail.composeFile).toContain("    build:\n");
    expect(parseManaged(detail.composeFile)).toMatchObject({ history });
    expect(pruneComposeAppImages).not.toHaveBeenCalled();
  });

  it("restores the corrected build compose when Dokploy rejects the fix-up deploy", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    const fetchApi = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).endsWith("/compose.deploy")
        ? Promise.resolve(new Response("Forbidden", { status: 403 })) : fetchApi(input, init));
    await runWatcher();
    expect(deployments()).toHaveLength(1);
    expect(detail.composeFile).toContain("    build:\n");
    expect(parseManaged(detail.composeFile)).toMatchObject({ autoDomain: { host, port: 80 } });
    expect(parseManaged(detail.composeFile)).not.toHaveProperty("pinnedTag");
    expect(pruneComposeAppImages).toHaveBeenCalledOnce();
  });

  it("waits for an enqueued fix-up after its acknowledgement is lost, retrying a failed restore", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const fetchApi = vi.mocked(fetch).getMockImplementation()!;
    let failRestore = true;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (String(input).endsWith("/compose.deploy")) {
        await fetchApi(input, init);
        throw new Error("Lost response after enqueue");
      }
      if (String(input).endsWith("/compose.update") && detail.deployments.length === 2 &&
          body.composeFile?.includes("    build:\n") && failRestore) {
        failRestore = false;
        return new Response("Unavailable", { status: 503 });
      }
      return fetchApi(input, init);
    });
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(150);
    expect(detail.composeFile).not.toMatch(/^    build:/m);
    expect(deployments()).toHaveLength(2);
    expect(pruneComposeAppImages).not.toHaveBeenCalled();
    detail.deployments[1].status = "done";
    detail.composeStatus = "done";
    await vi.advanceTimersByTimeAsync(10);
    expect(detail.composeFile).not.toMatch(/^    build:/m);
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(detail.composeFile).toContain("    build:\n");
    expect(parseManaged(detail.composeFile)).not.toHaveProperty("pinnedTag");
    expect(pruneComposeAppImages).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite a compose file edited directly in Dokploy during the fix-up", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    detail.composeFile = "services:\n  app:\n    image: nginx:alpine\n";
    detail.deployments[1].status = "done";
    detail.composeStatus = "done";
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(detail.composeFile).toBe("services:\n  app:\n    image: nginx:alpine\n");
  });

  it("finishes restoring the build compose before an explicit redeploy requested during the fix-up", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    finishFixup = false;
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    const redeploy = composeAction("compose-1", "deploy");
    await vi.advanceTimersByTimeAsync(10);
    expect(deployments()).toHaveLength(2);
    expect(detail.composeFile).not.toMatch(/^    build:/m);
    detail.deployments[1].status = "done";
    detail.composeStatus = "done";
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all([pending, redeploy]);
    expect(deployments()).toHaveLength(3);
    expect(deployedFiles[2]).toContain("    build:\n");
    const managed = parseManaged(detail.composeFile);
    if (managed?.kind !== "repo") throw new Error("Expected managed repo metadata");
    expect(managed.history).toHaveLength(1);
    expect(managed).not.toHaveProperty("pinnedTag");
  });

  it("still deploys and repairs the port when fetching the public Dockerfile fails", async () => {
    const fetchApi = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).includes("raw.githubusercontent.com")
        ? Promise.reject(new Error("Unavailable")) : fetchApi(input, init));
    await deployBridgeRepo("repo", { ...source, repoUrl: "https://github.com/example/repo" }, "env-1");
    expect(deployments()).toHaveLength(1);
    finishBuild();
    await runWatcher();
    expect(detail.domains[0].port).toBe(80);
    expect(deployments()).toHaveLength(2);
  });

  it("preserves a Networking edit, including explicitly selecting fallback port 3000", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    expect(await updateDomainAction("domain-1", { host, port: 3000, https: false, certificateType: "none" }, "compose-1"))
      .toEqual({ ok: true });
    await runWatcher();
    expect(detail.domains[0].port).toBe(3000);
    expect(deployments()).toHaveLength(2); // initial + Networking edit
    expect(updates()).toHaveLength(1); // explicit edit only
  });

  it("leaves a port edited directly in Dokploy alone", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    detail.domains[0].port = 9090;
    await runWatcher();
    expect(detail.domains[0].port).toBe(9090);
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it("rechecks a direct Dokploy edit made while local image inspection is pending", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    let inspected!: (ports: string[]) => void;
    vi.mocked(inspectImageExposedPorts).mockImplementationOnce(() => new Promise((resolve) => { inspected = resolve; }));
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    detail.domains[0].port = 9090;
    inspected(["80/tcp"]);
    await pending;
    expect(detail.domains[0].port).toBe(9090);
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it.each(["deploy", "stop", "Networking", "Compose file", "PORT"])("cancels in-flight detection before an explicit %s change", async (action) => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    let inspected!: (ports: string[]) => void;
    vi.mocked(inspectImageExposedPorts).mockImplementationOnce(() => new Promise((resolve) => { inspected = resolve; }));
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10);
    const file = detail.composeFile + "# user edit\n";
    const explicit = action === "deploy" ? composeAction("compose-1", "deploy")
      : action === "stop" ? composeAction("compose-1", "stop")
        : action === "PORT" ? saveServiceEnv({ kind: "compose", id: "compose-1" }, "PORT=3000")
      : action === "Networking" ? updateDomainAction("domain-1", { host, port: 9090, https: false, certificateType: "none" }, "compose-1")
        : saveComposeFileAction("compose-1", file);
    await vi.advanceTimersByTimeAsync(0);
    inspected(["80/tcp"]);
    await Promise.all([pending, explicit]);
    const redeploys = action === "deploy" || action === "Networking";
    expect(updates()).toHaveLength(redeploys ? 1 : 0);
    expect(deployments()).toHaveLength(redeploys ? 2 : 1);
    if (action === "Networking") expect(detail.domains[0].port).toBe(9090);
    if (action === "Compose file") expect(detail.composeFile).toContain("# user edit"); // #53 adds history
    if (action === "PORT") expect(detail.env).toBe("PORT=3000");
  });

  it("applies a correction accepted before the deadline even if the writes cross it", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    const fetchApi = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/domain.update")) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return fetchApi(input, init);
    });
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(detail.domains[0].port).toBe(80);
    expect(deployments()).toHaveLength(2);
  });

  it.each(["error", "another deployment", "changed deployment"])("does not follow up after %s", async (state) => {
    await deployBridgeRepo("repo", source, "env-1");
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(10); // capture first deployment identity while running
    finishBuild();
    if (state === "error") detail.deployments[0].status = "error";
    if (state === "another deployment") detail.deployments.push({ deploymentId: "external", status: "done" });
    if (state === "changed deployment") detail.deployments[0].deploymentId = "external";
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it("expires without acting on a stale done compose status or missing deployment record", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    detail.deployments = [];
    const pending = background[0]();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
  });

  it("does not throw or mutate when background authorization expires", async () => {
    await deployBridgeRepo("repo", source, "env-1");
    finishBuild();
    vi.mocked(fetch).mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await runWatcher();
    expect(updates()).toHaveLength(0);
    expect(deployments()).toHaveLength(1);
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("compose.one?composeId=compose-1"),
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: "dokploy-session=test" }) }));
  });
});
