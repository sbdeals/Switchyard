import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyStagedOperations, type ApplyOperation } from "./staged-apply";
import { imageStack } from "./managed-compose";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("./dokploy", () => Object.fromEntries([
  "loadWorkspace", "listMounts", "listProjects", "generateHostFor", "redeployManagedImage",
  "updateApplication", "saveAppBuildType", "setAppDockerSource", "setAppGitSource", "setAppAutoDeploy",
  "saveServiceEnv", "applicationAction", "databaseAction", "composeAction", "updateDatabase", "reloadDatabase",
  "request", "saveComposeFile", "stopBridgeRepoPortWatch", "createDomain", "updateDomain", "deleteDomain",
  "createComposeDomain", "createPort", "createMount", "updateMount", "removeMount",
].map((name) => [name, vi.fn().mockResolvedValue(undefined)])));

import * as engine from "./dokploy";
import { applyStagedChangesAction, generateDomainPreviewAction } from "@/app/staged-actions";

describe("applyStagedOperations", () => {
  it("applies source, build, settings, variables, networking and volumes, then deploys once", async () => {
    const operations: ApplyOperation[] = [
      { id: "volume", action: "createMountAction" },
      { id: "network", action: "createDomainAction" },
      { id: "settings", action: "updateApplicationAction" },
      { id: "variables", action: "saveApplicationEnvAction" },
      { id: "build", action: "saveAppBuildTypeAction" },
      { id: "source", action: "setAppDockerSourceAction" },
    ];
    const calls: string[] = [];
    const report = await applyStagedOperations(operations, async (op) => {
      calls.push(op.id);
      return { ok: true };
    }, async () => { calls.push("deploy"); return { ok: true }; });
    expect(calls).toEqual(["source", "build", "settings", "variables", "network", "volume", "deploy"]);
    expect(report).toEqual({ ok: true, applied: calls.slice(0, -1), skipped: [], deploy: "succeeded" });
    expect(operations[0].id).toBe("volume");
  });

  it("removes conflicting network mappings before adding replacements", async () => {
    const calls: string[] = [];
    await applyStagedOperations([
      { id: "add", action: "createPortAction" }, { id: "remove", action: "deletePortAction" },
    ], async (op) => { calls.push(op.id); return { ok: true }; }, async () => ({ ok: true }));
    expect(calls).toEqual(["remove", "add"]);
  });

  it.each([false, true])("reports applied, failed and skipped changes without deploying (throw=%s)", async (throws) => {
    const deploy = vi.fn();
    const report = await applyStagedOperations([
      { id: "source", action: "setAppDockerSourceAction" },
      { id: "env", action: "saveApplicationEnvAction" },
      { id: "volume", action: "createMountAction" },
    ], async (op) => {
      if (op.id === "env") {
        if (throws) throw new Error("Unable to save variables");
        return { ok: false, error: "Unable to save variables" };
      }
      return { ok: true };
    }, deploy);
    expect(report).toEqual({
      ok: false, applied: ["source"], failed: { id: "env", error: "Unable to save variables" },
      skipped: ["volume"], deploy: "skipped",
    });
    expect(deploy).not.toHaveBeenCalled();
  });

  it("retains applied IDs after deployment fails and retries deployment without replay", async () => {
    const apply = vi.fn().mockResolvedValue({ ok: true });
    const deploy = vi.fn().mockResolvedValueOnce({ ok: false, error: "Deployment unavailable" }).mockResolvedValue({ ok: true });
    expect(await applyStagedOperations([{ id: "env", action: "saveApplicationEnvAction" }], apply, deploy)).toEqual({
      ok: false, applied: ["env"], skipped: [], deploy: "failed", error: "Deployment unavailable",
    });
    expect(await applyStagedOperations([], apply, deploy)).toEqual({ ok: true, applied: [], skipped: [], deploy: "succeeded" });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(deploy).toHaveBeenCalledTimes(2);
  });
});

const target = { kind: "application" as const, id: "app-1" };
const application = {
  ...target, appName: "test-app", domains: [{ domainId: "domain-1" }],
  ports: [], redirects: [], security: [],
} as unknown as engine.Application;

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(engine)) if (vi.isMockFunction(mock)) mock.mockResolvedValue(undefined);
  vi.mocked(engine.loadWorkspace).mockResolvedValue({ services: [application], projects: [] });
  vi.mocked(engine.listMounts).mockResolvedValue([]);
  vi.mocked(engine.request).mockResolvedValue({});
});

describe("staged server action", () => {
  it("reuses settings actions and sends exactly one deployment after three edits", async () => {
    const report = await applyStagedChangesAction(target, [
      { id: "env", action: "saveApplicationEnvAction", args: [target.id, "PORT=8080"] },
      { id: "command", action: "updateApplicationAction", args: [target.id, { command: "node server.js" }, true] },
      { id: "image", action: "setAppDockerSourceAction", args: [target.id, "nginx:alpine", undefined, true] },
    ]);
    expect(report).toEqual({ ok: true, applied: ["image", "command", "env"], skipped: [], deploy: "succeeded" });
    expect(engine.setAppDockerSource).toHaveBeenCalledWith(target.id, "nginx:alpine", undefined);
    expect(engine.updateApplication).toHaveBeenCalledWith(target.id, { command: "node server.js" });
    expect(engine.saveServiceEnv).toHaveBeenCalledWith(target, "PORT=8080");
    expect(engine.applicationAction).toHaveBeenCalledExactlyOnceWith(target.id, "deploy");
  });

  it.each([undefined, null])("preserves private registry credentials for omitted registry %s and masks them on failure", async (omitted) => {
    const registry = { username: "robot-user", password: "stored-secret", registryUrl: "registry.example.invalid" };
    vi.mocked(engine.request).mockResolvedValue(registry);
    vi.mocked(engine.setAppDockerSource).mockRejectedValue(new Error("Rejected password stored-secret"));
    const report = await applyStagedChangesAction(target, [
      { id: "image", action: "setAppDockerSourceAction", args: [target.id, "private/image:v2", omitted] },
    ]);
    expect(engine.request).toHaveBeenCalledWith("application.one?applicationId=app-1");
    expect(engine.setAppDockerSource).toHaveBeenCalledWith(target.id, "private/image:v2", registry);
    expect(report.failed?.error).toBe("Rejected password ••••••");
    expect(JSON.stringify(report)).not.toContain("stored-secret");
    expect(engine.applicationAction).not.toHaveBeenCalled();
  });

  it("honors an explicit registry replacement without restoring stored credentials", async () => {
    const registry = { username: "", password: "", registryUrl: "new.example.invalid" };
    const report = await applyStagedChangesAction(target, [
      { id: "image", action: "setAppDockerSourceAction", args: [target.id, "private/image:v2", registry] },
    ]);
    expect(report.ok).toBe(true);
    expect(engine.request).not.toHaveBeenCalled();
    expect(engine.setAppDockerSource).toHaveBeenCalledWith(target.id, "private/image:v2", registry);
  });

  it("validates all selectors before writing and rejects target overrides inside patches", async () => {
    const report = await applyStagedChangesAction(target, [
      { id: "env", action: "saveApplicationEnvAction", args: [target.id, "PORT=8080"] },
      { id: "patch", action: "updateApplicationAction", args: [target.id, { applicationId: "other", command: "bad" }] },
    ]);
    expect(report.failed).toEqual({ id: "patch", error: "Unsupported settings field." });
    expect(report.applied).toEqual([]);
    expect(report.skipped).toEqual(["env"]);
    expect(engine.saveServiceEnv).not.toHaveBeenCalled();
    expect(engine.applicationAction).not.toHaveBeenCalled();
  });

  it("reports malformed payloads and inaccessible targets without making writes", async () => {
    const malformed = { id: "bad", action: "saveApplicationEnvAction", args: null } as unknown as Parameters<typeof applyStagedChangesAction>[1][number];
    const report = await applyStagedChangesAction(target, [malformed]);
    expect(report.ok).toBe(false);
    expect(report.failed?.id).toBe("bad");
    expect(engine.loadWorkspace).not.toHaveBeenCalled();
    vi.mocked(engine.loadWorkspace).mockResolvedValue({ services: [], projects: [] });
    expect(await applyStagedChangesAction(target, [
      { id: "env", action: "saveApplicationEnvAction", args: [target.id, "X=1"] },
    ])).toEqual({
      ok: false, applied: [], failed: { id: "validation", error: "Service not found or access denied." },
      skipped: ["env"], deploy: "skipped",
    });
    expect(engine.saveServiceEnv).not.toHaveBeenCalled();
    expect(engine.applicationAction).not.toHaveBeenCalled();
  });

  it.each([
    { id: "foreign-service", action: "saveApplicationEnvAction" as const, args: ["another-app", "X=1"] },
    { id: "foreign-domain", action: "deleteDomainAction" as const, args: ["another-domain"] },
    { id: "foreign-volume", action: "removeMountAction" as const, args: ["another-volume"] },
  ])("rejects settings for other resources: $id", async (operation) => {
    const report = await applyStagedChangesAction(target, [operation]);
    expect(report.failed?.error).toBe("The change does not belong to this service.");
    expect(report.deploy).toBe("skipped");
    expect(engine.applicationAction).not.toHaveBeenCalled();
  });

  it("reports which Git substep applied when auto-deploy fails", async () => {
    vi.mocked(engine.setAppAutoDeploy).mockRejectedValue(new Error("Auto-deploy unavailable"));
    const report = await applyStagedChangesAction(target, [
      { id: "git", action: "updateGitDeployAction", args: [target.id, { gitUrl: "https://example.invalid/repo", branch: "main", autoDeploy: false }] },
      { id: "env", action: "saveApplicationEnvAction", args: [target.id, "X=1"] },
    ]);
    expect(report).toEqual({
      ok: false, applied: [], skipped: ["env"], deploy: "skipped",
      failed: { id: "git", error: "Auto-deploy unavailable", appliedSteps: ["Git source"], failedStep: "Auto-deploy" },
    });
    expect(engine.setAppGitSource).toHaveBeenCalledOnce();
    expect(engine.saveServiceEnv).not.toHaveBeenCalled();
  });

  it("reports a database settings write separately from a failed external-port write", async () => {
    const db = { kind: "database" as const, id: "db-1", engine: "postgres" as const, appName: "database" };
    vi.mocked(engine.loadWorkspace).mockResolvedValue({ services: [db as engine.Database], projects: [] });
    vi.mocked(engine.request).mockRejectedValue(new Error("Port already in use"));
    const report = await applyStagedChangesAction(db, [
      { id: "settings", action: "updateDatabaseAction", args: [db.engine, db.id, db.appName, { dockerImage: "postgres:17", externalPort: 5433 }] },
    ]);
    expect(report.failed).toEqual({ id: "settings", error: "Port already in use", appliedSteps: ["Database settings"], failedStep: "External port" });
    expect(engine.updateDatabase).toHaveBeenCalledWith(db.engine, db.id, { dockerImage: "postgres:17" });
    expect(engine.reloadDatabase).not.toHaveBeenCalled();
    expect(engine.databaseAction).not.toHaveBeenCalled();
  });

  it("suppresses database reloads until the single final deployment", async () => {
    const db = { kind: "database" as const, id: "db-1", engine: "postgres" as const, appName: "database" };
    vi.mocked(engine.loadWorkspace).mockResolvedValue({ services: [db as engine.Database], projects: [] });
    const report = await applyStagedChangesAction(db, [
      { id: "settings", action: "updateDatabaseAction", args: [db.engine, db.id, db.appName, { memoryLimit: "512m", externalPort: 5433 }] },
      { id: "env", action: "saveEnvironmentAction", args: [db.engine, db.id, "X=1"] },
    ]);
    expect(report.ok).toBe(true);
    expect(engine.request).toHaveBeenCalledWith("postgres.saveExternalPort", { method: "POST", body: { postgresId: db.id, externalPort: 5433 } });
    expect(engine.reloadDatabase).not.toHaveBeenCalled();
    expect(engine.databaseAction).toHaveBeenCalledExactlyOnceWith(db.engine, db.id, "deploy");
  });

  it("applies compose file, variables and domain without internal redeploys", async () => {
    const compose = { kind: "compose" as const, id: "compose-1", managed: { kind: "image" }, domains: [] } as unknown as engine.ComposeService;
    vi.mocked(engine.loadWorkspace).mockResolvedValue({ services: [compose], projects: [] });
    vi.mocked(engine.request).mockResolvedValue({ composeFile: imageStack({ appName: "test-app", image: "nginx:alpine" }) });
    const report = await applyStagedChangesAction(compose, [
      { id: "domain", action: "createComposeDomainAction", args: [compose.id, "app", "test.localhost", 80, { https: false, certificateType: "none" }] },
      { id: "file", action: "saveComposeFileAction", args: [compose.id, "services: {}", true] },
      { id: "env", action: "saveComposeEnvAction", args: [compose.id, "X=1"] },
    ]);
    expect(report.applied).toEqual(["file", "env", "domain"]);
    expect(engine.saveComposeFile).toHaveBeenCalledWith(compose.id, "services: {}", false);
    expect(engine.createComposeDomain).toHaveBeenCalledWith(compose.id, "app", "test.localhost", 80, { https: false, certificateType: "none" });
    expect(engine.redeployManagedImage).toHaveBeenCalledExactlyOnceWith(compose.id);
    expect(engine.composeAction).not.toHaveBeenCalled();
  });

  it("deploys once when a staged compose file removes managed metadata before networking changes", async () => {
    const compose = { kind: "compose" as const, id: "compose-1", managed: { kind: "image" }, domains: [] } as unknown as engine.ComposeService;
    vi.mocked(engine.loadWorkspace).mockResolvedValue({ services: [compose], projects: [] });
    vi.mocked(engine.request).mockResolvedValue({ composeFile: "services: {}" });
    const report = await applyStagedChangesAction(compose, [
      { id: "file", action: "saveComposeFileAction", args: [compose.id, "services: {}"] },
      { id: "domain", action: "createComposeDomainAction", args: [compose.id, "app", "test.localhost", 80] },
    ]);
    expect(report.ok).toBe(true);
    expect(engine.redeployManagedImage).not.toHaveBeenCalled();
    expect(engine.composeAction).toHaveBeenCalledExactlyOnceWith(compose.id, "deploy");
  });

  it("retains managed networking intent on deployment-only retry without replaying edits", async () => {
    const compose = { kind: "compose" as const, id: "compose-1", managed: { kind: "image" }, domains: [] } as unknown as engine.ComposeService;
    vi.mocked(engine.loadWorkspace).mockResolvedValue({ services: [compose], projects: [] });
    vi.mocked(engine.request).mockResolvedValue({ composeFile: imageStack({ appName: "test-app", image: "nginx:alpine" }) });
    const report = await applyStagedChangesAction({ ...compose, networkingChanged: true }, []);
    expect(report).toEqual({ ok: true, applied: [], skipped: [], deploy: "succeeded" });
    expect(engine.redeployManagedImage).toHaveBeenCalledExactlyOnceWith(compose.id);
    expect(engine.createComposeDomain).not.toHaveBeenCalled();
    expect(engine.updateDomain).not.toHaveBeenCalled();
    expect(engine.composeAction).not.toHaveBeenCalled();
  });

  it("does not echo scalars from opaque secret-bearing compose documents", async () => {
    const compose = { kind: "compose" as const, id: "compose-1", managed: null, domains: [] } as unknown as engine.ComposeService;
    vi.mocked(engine.loadWorkspace).mockResolvedValue({ services: [compose], projects: [] });
    vi.mocked(engine.saveComposeFile).mockRejectedValue(new Error("Invalid password scalar yaml-secret"));
    const report = await applyStagedChangesAction(compose, [
      { id: "file", action: "saveComposeFileAction", args: [compose.id, "services:\n  app:\n    environment:\n      PASSWORD: yaml-secret"] },
    ]);
    expect(report.failed?.error).toBe("The engine rejected the configuration. Check the service settings and try again.");
    expect(JSON.stringify(report)).not.toContain("yaml-secret");
  });

  it.each(["TOKEN=super-secret", 'TOKEN="super-secret"'])("masks secret values echoed by engine errors (%s)", async (env) => {
    vi.mocked(engine.saveServiceEnv).mockRejectedValue(new Error("Invalid variable value: super-secret"));
    const report = await applyStagedChangesAction(target, [
      { id: "env", action: "saveApplicationEnvAction", args: [target.id, env] },
    ]);
    expect(report.failed?.error).toBe("Invalid variable value: ••••••");
    expect(JSON.stringify(report)).not.toContain("super-secret");
  });

  it("previews generated domains without creating or deploying them", async () => {
    const host = { host: "test.localhost", https: false, certificateType: "none" as const };
    vi.mocked(engine.generateHostFor).mockResolvedValue(host);
    expect(await generateDomainPreviewAction("test")).toEqual({ ok: true, ...host });
    expect(engine.listProjects).toHaveBeenCalledOnce();
    expect(engine.createDomain).not.toHaveBeenCalled();
    expect(engine.applicationAction).not.toHaveBeenCalled();
  });
});
