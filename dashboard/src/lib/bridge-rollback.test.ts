import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard-session",
  openSession: () => ({ dokployCookie: "dokploy-session=test" }),
}));
vi.mock("./docker", () => ({
  inspectNetwork: vi.fn(),
  inspectImageExposedPorts: vi.fn(),
  deriveComposeRuntime: vi.fn(),
  deriveSwarmRuntime: vi.fn(),
  listRuntimeStates: vi.fn(),
  snapshotComposeAppImage: vi.fn(),
  verifyComposeAppImage: vi.fn(),
  pruneComposeAppImages: vi.fn(),
}));

import {
  composeLifecycleAction,
  createComposeDomainAction,
  quickDeployImageAction,
  rollbackComposeAction,
  saveComposeFileAction,
} from "@/app/actions";
import {
  inspectImageExposedPorts,
  pruneComposeAppImages,
  snapshotComposeAppImage,
  verifyComposeAppImage,
} from "./docker";
import {
  imageStack,
  parseManaged,
  repoSnapshotTag,
  repoStack,
  rewriteManagedApp,
  writeManagedMeta,
  type ManagedDeployEntry,
} from "./managed-compose";

const appName = "welcome-a1b2";
const repoUrl = "https://github.com/docker/welcome-to-docker";
const now = "2026-10-23T12:00:00.000Z";
const prior = "2026-10-22T12:00:00.000Z";
const domain = { domainId: "domain-1", host: "web.example.com", serviceName: "app" };
let detail: {
  appName: string;
  composeFile: string;
  composeStatus: string;
  env: string;
  domains: typeof domain[];
  deployments: { status: string; createdAt: string }[];
};
let requests: { procedure: string; body: Record<string, unknown>; cookie: string | null }[];
let denied: boolean;
let events: string[];

function appMeta() {
  const managed = parseManaged(detail.composeFile);
  if (!managed || managed.kind === "database") throw new Error("Expected managed app metadata");
  return managed;
}

function historyEntries(count = 1): ManagedDeployEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const timestamp = new Date(Date.parse(prior) - index * 60_000).toISOString();
    return { timestamp, image: repoSnapshotTag(appName, timestamp) };
  });
}

function withHistory(history = historyEntries(), pinned = false) {
  const managed = appMeta();
  if (managed.kind !== "repo") throw new Error("Expected repo metadata");
  managed.history = history;
  if (pinned) {
    managed.image = history[0].image;
    managed.pinnedTag = history[0].image;
    detail.composeFile = rewriteManagedApp(detail.composeFile, appName, managed);
  }
  detail.composeFile = writeManagedMeta(detail.composeFile, managed);
  return history;
}

function mutations() {
  return requests.filter(({ procedure }) => procedure !== "compose.one");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  vi.stubEnv("SWITCHYARD_DEPLOY_TARGET", "bridge");
  vi.stubEnv("SWITCHYARD_HOST_IP", "");
  detail = {
    appName,
    composeFile: repoStack({ appName, repoUrl, branch: "release", subdirectory: "apps/web", dockerfile: "docker/Dockerfile.prod" }),
    composeStatus: "done",
    env: "MESSAGE=hello",
    domains: [domain],
    deployments: [{ status: "done", createdAt: prior }],
  };
  requests = [];
  events = [];
  denied = false;
  vi.mocked(inspectImageExposedPorts).mockResolvedValue([]);
  vi.mocked(snapshotComposeAppImage).mockImplementation(async () => { events.push("snapshot"); });
  vi.mocked(verifyComposeAppImage).mockImplementation(async () => { events.push("verify"); });
  vi.mocked(pruneComposeAppImages).mockImplementation(async () => { events.push("prune"); });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const procedure = new URL(url).pathname.replace("/api/", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ procedure, body, cookie: new Headers(init.headers).get("cookie") });
    events.push(procedure);
    switch (procedure) {
      case "compose.one": return denied ? Response.json({ message: "Forbidden" }, { status: 403 }) : Response.json(detail);
      case "compose.create":
        detail.composeStatus = "idle";
        detail.deployments = [];
        return Response.json({ composeId: "compose-1", appName });
      case "compose.update":
        if (typeof body.composeFile === "string") detail.composeFile = body.composeFile;
        return Response.json({});
      case "compose.deploy":
      case "domain.create": return Response.json({});
      default: throw new Error(`Unexpected request: ${procedure}`);
    }
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("bridge image rollback", () => {
  it("records the exact image reference on the initial quick deploy", async () => {
    expect(await quickDeployImageAction("nginx:1.26", "nginx", "environment-1"))
      .toEqual({ ok: true, id: "compose-1" });
    expect(appMeta()).toMatchObject({ kind: "image", image: "nginx:1.26", history: [{ timestamp: now, image: "nginx:1.26" }] });
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
    expect(snapshotComposeAppImage).not.toHaveBeenCalled();
    expect(requests.every(({ cookie }) => cookie === "dokploy-session=test")).toBe(true);
  });

  it("preserves the old reference when the editor changes only the service image, then rolls back by timestamp", async () => {
    detail.composeFile = imageStack({ appName, image: "nginx:1.26" });
    const staleEditor = detail.composeFile;
    expect(await composeLifecycleAction("compose-1", "deploy")).toEqual({ ok: true });
    vi.setSystemTime(new Date(Date.parse(now) + 1000));
    const edited = staleEditor.replace("    image: nginx:1.26", "    image: nginx:1.27");
    expect(await saveComposeFileAction("compose-1", edited, true)).toEqual({ ok: true });
    expect(appMeta()).toMatchObject({ image: "nginx:1.27", history: [
      { timestamp: "2026-10-23T12:00:01.000Z", image: "nginx:1.27" },
      { timestamp: now, image: "nginx:1.26" },
    ] });
    vi.setSystemTime(new Date(Date.parse(now) + 2000));
    expect(await rollbackComposeAction("compose-1", now)).toEqual({ ok: true });
    expect(appMeta()).toMatchObject({ image: "nginx:1.26" });
    expect(detail.composeFile).toContain("    image: nginx:1.26\n");
    expect(detail.composeFile).toContain("    env_file:\n      - .env");
    expect(detail.domains).toEqual([domain]);
    expect(requests.filter(({ procedure }) => procedure === "compose.deploy")).toHaveLength(3);
    expect(snapshotComposeAppImage).not.toHaveBeenCalled();
  });

  it("retains a legacy app's old reference when saving without deploying", async () => {
    detail.composeFile = imageStack({ appName, image: "nginx:1.26" });
    const edited = detail.composeFile.replace("    image: nginx:1.26", "    image: nginx:1.27");
    expect(await saveComposeFileAction("compose-1", edited)).toEqual({ ok: true });
    expect(appMeta()).toMatchObject({ image: "nginx:1.27", history: [{ timestamp: now, image: "nginx:1.26" }] });
    expect(requests.some(({ procedure }) => procedure === "compose.deploy")).toBe(false);
  });

  it("does not record an image that was only saved in the editor and never deployed", async () => {
    detail.composeFile = imageStack({ appName, image: "nginx:1.25" });
    expect(await saveComposeFileAction("compose-1", detail.composeFile.replace("    image: nginx:1.25", "    image: nginx:1.26")))
      .toEqual({ ok: true });
    vi.setSystemTime(new Date(Date.parse(now) + 1000));
    expect(await saveComposeFileAction("compose-1", detail.composeFile.replace("    image: nginx:1.26", "    image: nginx:1.27")))
      .toEqual({ ok: true });
    expect(appMeta()).toMatchObject({ image: "nginx:1.27", history: [{ timestamp: now, image: "nginx:1.25" }] });
    expect(requests.some(({ procedure }) => procedure === "compose.deploy")).toBe(false);
  });
});

describe("bridge repo rollback", () => {
  it("saves the running image before a normal redeploy overwrites latest", async () => {
    expect(await composeLifecycleAction("compose-1", "deploy")).toEqual({ ok: true });
    const image = repoSnapshotTag(appName, now);
    expect(snapshotComposeAppImage).toHaveBeenCalledWith(appName, image);
    expect(appMeta()).toMatchObject({ image: `${appName}-app:latest`, history: [{ timestamp: now, image }], rollbackUnavailable: false });
    expect(detail.composeFile).toContain("    build:\n");
    expect(events.indexOf("snapshot")).toBeLessThan(events.indexOf("compose.update"));
    expect(events.indexOf("compose.update")).toBeLessThan(events.indexOf("compose.deploy"));
  });

  it("persists a safe warning and still deploys when saving the running image fails", async () => {
    vi.mocked(snapshotComposeAppImage).mockRejectedValueOnce(new Error("sensitive Docker failure details"));
    expect(await composeLifecycleAction("compose-1", "deploy")).toEqual({ ok: true });
    expect(appMeta()).toMatchObject({ rollbackUnavailable: true });
    expect(detail.composeFile).not.toContain("sensitive Docker");
    expect(requests.some(({ procedure }) => procedure === "compose.deploy")).toBe(true);
  });

  it("pins a rollback without build, preserving app settings, then restores the source build on normal redeploy", async () => {
    const [target] = withHistory();
    detail.composeFile = detail.composeFile.replace("    restart:", "    labels:\n      traefik.enable: true\n    restart:");
    expect(await rollbackComposeAction("compose-1", target.timestamp)).toEqual({ ok: true });
    expect(verifyComposeAppImage).toHaveBeenCalledWith(appName, target.image);
    expect(appMeta()).toMatchObject({ image: target.image, pinnedTag: target.image });
    expect(detail.composeFile).not.toContain("    build:");
    expect(detail.composeFile).toContain(`    image: ${target.image}\n`);
    expect(detail.composeFile).toContain("    env_file:\n      - .env");
    expect(detail.composeFile).toContain(`          - ${appName}`);
    expect(detail.composeFile).toContain("      traefik.enable: true");
    expect(detail.domains).toEqual([domain]);
    expect(detail.env).toBe("MESSAGE=hello");
    expect(events.indexOf("verify")).toBeLessThan(events.indexOf("snapshot"));
    expect(events.indexOf("snapshot")).toBeLessThan(events.indexOf("compose.deploy"));

    vi.mocked(snapshotComposeAppImage).mockClear();
    vi.setSystemTime(new Date(Date.parse(now) + 1000));
    expect(await composeLifecycleAction("compose-1", "deploy")).toEqual({ ok: true });
    expect(appMeta()).toMatchObject({ image: `${appName}-app:latest`, branch: "release", subdirectory: "apps/web", dockerfile: "docker/Dockerfile.prod" });
    expect(appMeta()).not.toHaveProperty("pinnedTag");
    expect(detail.composeFile).toContain("    build:\n");
    expect(detail.composeFile).toContain(`${repoUrl}.git#release:apps/web`);
    expect(detail.composeFile).toContain("      dockerfile: docker/Dockerfile.prod");
    expect(detail.composeFile).toContain("      traefik.enable: true");
    expect(snapshotComposeAppImage).not.toHaveBeenCalled();
  });

  it("keeps the saved image pinned when Networking redeploys domain labels", async () => {
    const [target] = withHistory(historyEntries(), true);
    expect(await createComposeDomainAction("compose-1", "app", "second.example.com", 8080)).toEqual({ ok: true });
    expect(appMeta()).toMatchObject({ image: target.image, pinnedTag: target.image });
    expect(detail.composeFile).not.toContain("    build:");
    expect(verifyComposeAppImage).toHaveBeenCalledWith(appName, target.image);
    expect(snapshotComposeAppImage).not.toHaveBeenCalled();
    expect(requests.some(({ procedure }) => procedure === "domain.create")).toBe(true);
    expect(requests.some(({ procedure }) => procedure === "compose.deploy")).toBe(true);
  });

  it("caps history at five and prunes only the expired local tag after deploying", async () => {
    const history = withHistory(historyEntries(5));
    expect(await composeLifecycleAction("compose-1", "deploy")).toEqual({ ok: true });
    expect(appMeta().history).toHaveLength(5);
    expect(appMeta().history?.[0].image).toBe(repoSnapshotTag(appName, now));
    expect(pruneComposeAppImages).toHaveBeenCalledWith(appName, [history[4].image]);
    expect(events.indexOf("prune")).toBeGreaterThan(events.indexOf("compose.deploy"));
  });

  it("keeps the oldest selected rollback target when saving the current image at the cap", async () => {
    const history = withHistory(historyEntries(5));
    const target = history[4];
    expect(await rollbackComposeAction("compose-1", target.timestamp)).toEqual({ ok: true });
    expect(appMeta().history).toHaveLength(5);
    expect(appMeta()).toMatchObject({ pinnedTag: target.image });
    expect(appMeta().history).toContainEqual({ timestamp: "2026-10-23T12:00:00.001Z", image: target.image });
    expect(appMeta().history).toContainEqual({ timestamp: now, image: repoSnapshotTag(appName, now) });
    expect(pruneComposeAppImages).toHaveBeenCalledWith(appName, [history[3].image]);
  });

  it.each([false, true])("rejects a missing local image before updating or deploying (legacy env_file: %s)", async (legacy) => {
    const [target] = withHistory();
    if (legacy) detail.composeFile = detail.composeFile.replace("    env_file:\n      - .env\n", "");
    const originalFile = detail.composeFile;
    vi.mocked(verifyComposeAppImage).mockRejectedValueOnce(new Error("Rollback image is missing"));
    expect(await rollbackComposeAction("compose-1", target.timestamp)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(detail.composeFile).toBe(originalFile);
    expect(mutations()).toEqual([]);
    expect(snapshotComposeAppImage).not.toHaveBeenCalled();
    expect(pruneComposeAppImages).not.toHaveBeenCalled();
  });
});

describe("bridge rollback authorization and validation", () => {
  it.each(["rollback", "deploy", "save"])("does not touch Docker or mutate an unauthorized stack (%s)", async (action) => {
    const [target] = withHistory();
    denied = true;
    const result = action === "rollback" ? await rollbackComposeAction("compose-1", target.timestamp)
      : action === "deploy" ? await composeLifecycleAction("compose-1", "deploy")
        : await saveComposeFileAction("compose-1", detail.composeFile, true);
    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    expect(mutations()).toEqual([]);
    expect(requests.every(({ cookie }) => cookie === "dokploy-session=test")).toBe(true);
    expect(snapshotComposeAppImage).not.toHaveBeenCalled();
    expect(verifyComposeAppImage).not.toHaveBeenCalled();
    expect(pruneComposeAppImages).not.toHaveBeenCalled();
    expect(inspectImageExposedPorts).not.toHaveBeenCalled();
  });

  it.each(["not-a-date", "$(docker ps)", "2025-01-01T00:00:00.000Z"])("rejects an unknown rollback timestamp (%s)", async (timestamp) => {
    withHistory();
    expect(await rollbackComposeAction("compose-1", timestamp)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(mutations()).toEqual([]);
    expect(snapshotComposeAppImage).not.toHaveBeenCalled();
    expect(verifyComposeAppImage).not.toHaveBeenCalled();
  });

  it("rejects another app's local image before accessing Docker", async () => {
    const foreign = { timestamp: prior, image: repoSnapshotTag("other-app", prior) };
    withHistory([foreign]);
    expect(await rollbackComposeAction("compose-1", prior)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(mutations()).toEqual([]);
    expect(verifyComposeAppImage).not.toHaveBeenCalled();
    expect(snapshotComposeAppImage).not.toHaveBeenCalled();
  });

  it.each(["compose", "deployment"])("blocks rollback while the %s status is running", async (source) => {
    const [target] = withHistory();
    if (source === "compose") detail.composeStatus = "running";
    else detail.deployments[0].status = "running";
    expect(await rollbackComposeAction("compose-1", target.timestamp)).toMatchObject({ ok: false, error: expect.stringContaining("current deployment") });
    expect(mutations()).toEqual([]);
    expect(verifyComposeAppImage).not.toHaveBeenCalled();
    expect(snapshotComposeAppImage).not.toHaveBeenCalled();
  });
});
