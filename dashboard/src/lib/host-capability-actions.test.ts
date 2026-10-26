import { beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "@/app/actions";
import type {
  CreateBackupInput,
  CreateDestinationInput,
  CreateScheduleInput,
  RestoreBackupInput,
  UpdateBackupInput,
  UpdateScheduleInput,
} from "@/lib/dokploy";

const mocks = vi.hoisted(() => ({
  getHostCapabilities: vi.fn(),
  revalidatePath: vi.fn(),
  dokploy: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    createApplication: vi.fn(),
    setAppDockerSource: vi.fn(),
    setAppGitSource: vi.fn(),
    setAppGithubSource: vi.fn(),
    setAppAutoDeploy: vi.fn(),
    applicationAction: vi.fn(),
    updateApplication: vi.fn(),
    saveAppBuildType: vi.fn(),
    rollbackToDeployment: vi.fn(),
    ensureAutoDomain: vi.fn(),
    composeAction: vi.fn(),
    updateComposeFile: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    runSchedule: vi.fn(),
    createDatabaseBackup: vi.fn(),
    updateDatabaseBackup: vi.fn(),
    removeDatabaseBackup: vi.fn(),
    runDatabaseBackup: vi.fn(),
    restoreBackup: vi.fn(),
    createDestination: vi.fn(),
    testDestination: vi.fn(),
    removeDestination: vi.fn(),
    listSchedules: vi.fn(),
    listDatabaseBackups: vi.fn(),
    listDestinations: vi.fn(),
    listBackupFiles: vi.fn(),
  },
}));

vi.mock("@/lib/dokploy", () => mocks.dokploy);
vi.mock("@/lib/host-capabilities-server", () => ({
  getHostCapabilities: mocks.getHostCapabilities,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));

const schedule: CreateScheduleInput = {
  applicationId: "app",
  name: "Daily job",
  cronExpression: "0 5 * * *",
  command: "echo ready",
};
const scheduleUpdate: UpdateScheduleInput = {
  name: schedule.name,
  cronExpression: schedule.cronExpression,
  command: schedule.command,
  shellType: "bash",
  enabled: true,
};
const backup: CreateBackupInput = {
  engine: "postgres",
  databaseId: "database",
  destinationId: "destination",
  database: "demo",
  schedule: "0 5 * * *",
  prefix: "/demo/",
  enabled: true,
};
const backupUpdate: UpdateBackupInput = {
  backupId: "backup",
  engine: backup.engine,
  destinationId: backup.destinationId,
  database: backup.database,
  schedule: backup.schedule,
  prefix: backup.prefix,
  enabled: true,
};
const restore: RestoreBackupInput = {
  engine: "postgres",
  databaseId: "database",
  databaseName: "demo",
  destinationId: "destination",
  backupFile: "/demo/backup.sql",
};
const destination: CreateDestinationInput = {
  name: "test destination",
  accessKey: "test-only",
  secretAccessKey: "test-only",
  bucket: "test",
  region: "test",
  endpoint: "http://localhost:9000",
};

type MutationCase = {
  name: string;
  run: () => Promise<actions.ActionResult | actions.QuickDeployResult>;
  effect: keyof typeof mocks.dokploy;
};

const swarmMutations: MutationCase[] = [
  { name: "Docker image deploy", run: () => actions.quickDeployImageAction("nginx:alpine"), effect: "createApplication" },
  { name: "public repository deploy", run: () => actions.quickDeployRepoAction("https://github.com/example/demo"), effect: "createApplication" },
  {
    name: "GitHub installation deploy",
    run: () => actions.quickDeployGithubAction({ githubId: "installation", owner: "example", repository: "demo", branch: "main" }),
    effect: "createApplication",
  },
  { name: "application deploy", run: () => actions.appLifecycleAction("app", "deploy"), effect: "applicationAction" },
  { name: "application start", run: () => actions.appLifecycleAction("app", "start"), effect: "applicationAction" },
  { name: "replica update", run: () => actions.updateApplicationAction("app", { replicas: 2 }), effect: "updateApplication" },
  { name: "healthcheck update", run: () => actions.updateApplicationAction("app", { healthCheckSwarm: { Test: ["CMD", "true"] } }), effect: "updateApplication" },
  { name: "healthcheck removal", run: () => actions.updateApplicationAction("app", { healthCheckSwarm: null }), effect: "updateApplication" },
  { name: "settings and redeploy", run: () => actions.updateApplicationAction("app", { name: "new name" }, true), effect: "updateApplication" },
  { name: "build settings and redeploy", run: () => actions.saveAppBuildTypeAction("app", { buildType: "dockerfile" }, true), effect: "saveAppBuildType" },
  { name: "Docker source and redeploy", run: () => actions.setAppDockerSourceAction("app", "nginx:alpine", undefined, true), effect: "setAppDockerSource" },
  {
    name: "enable automatic deploy",
    run: () => actions.updateGitDeployAction("app", { gitUrl: "https://github.com/example/demo", autoDeploy: true }),
    effect: "setAppAutoDeploy",
  },
  { name: "rollback", run: () => actions.rollbackDeploymentAction("rollback"), effect: "rollbackToDeployment" },
  { name: "schedule creation", run: () => actions.createScheduleAction(schedule), effect: "createSchedule" },
  { name: "schedule enabling", run: () => actions.updateScheduleAction("schedule", scheduleUpdate), effect: "updateSchedule" },
  { name: "schedule execution", run: () => actions.runScheduleAction("schedule"), effect: "runSchedule" },
  { name: "backup creation", run: () => actions.createDatabaseBackupAction(backup), effect: "createDatabaseBackup" },
  { name: "backup enabling", run: () => actions.updateDatabaseBackupAction(backupUpdate), effect: "updateDatabaseBackup" },
  { name: "backup execution", run: () => actions.runDatabaseBackupAction("postgres", "backup"), effect: "runDatabaseBackup" },
  { name: "backup restore", run: () => actions.restoreBackupAction(restore), effect: "restoreBackup" },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getHostCapabilities.mockResolvedValue({ mode: "bridge", dokployVersion: "v0.30.10" });
  mocks.dokploy.listProjects.mockResolvedValue([{ environments: [{ environmentId: "environment" }] }]);
  mocks.dokploy.createApplication.mockResolvedValue("new-app");
});

describe.each(["bridge", "worker"])("Swarm actions on a %s host", (mode) => {
  it.each(swarmMutations)("blocks $name before any Dokploy call", async ({ run }) => {
    mocks.getHostCapabilities.mockResolvedValue({ mode, dokployVersion: "v0.30.10" });

    expect(await run()).toEqual({ ok: false, error: expect.stringContaining("Docker Swarm") });
    for (const fn of Object.values(mocks.dokploy)) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe.each(["swarm", "unknown"])("Swarm actions on a %s host", (mode) => {
  it.each(swarmMutations)("allows $name", async ({ run, effect }) => {
    mocks.getHostCapabilities.mockResolvedValue({ mode, dokployVersion: "v0.30.10" });

    expect(await run()).toMatchObject({ ok: true });
    expect(mocks.dokploy[effect]).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("features available on a bridge host", () => {
  const mutations: MutationCase[] = [
    { name: "Compose deploy", run: () => actions.composeLifecycleAction("compose", "deploy"), effect: "composeAction" },
    { name: "Compose start", run: () => actions.composeLifecycleAction("compose", "start"), effect: "composeAction" },
    { name: "Compose save and redeploy", run: () => actions.saveComposeFileAction("compose", "services: {}", true), effect: "composeAction" },
    { name: "application stop", run: () => actions.appLifecycleAction("app", "stop"), effect: "applicationAction" },
    { name: "application removal", run: () => actions.appLifecycleAction("app", "remove"), effect: "applicationAction" },
    { name: "application settings save", run: () => actions.updateApplicationAction("app", { name: "new name" }), effect: "updateApplication" },
    { name: "build settings save", run: () => actions.saveAppBuildTypeAction("app", { buildType: "dockerfile" }), effect: "saveAppBuildType" },
    { name: "Docker source save", run: () => actions.setAppDockerSourceAction("app", "nginx:alpine"), effect: "setAppDockerSource" },
    { name: "disable automatic deploy", run: () => actions.updateGitDeployAction("app", { autoDeploy: false }), effect: "setAppAutoDeploy" },
    { name: "disable schedule", run: () => actions.updateScheduleAction("schedule", { ...scheduleUpdate, enabled: false }), effect: "updateSchedule" },
    { name: "delete schedule", run: () => actions.deleteScheduleAction("schedule"), effect: "deleteSchedule" },
    { name: "disable backup", run: () => actions.updateDatabaseBackupAction({ ...backupUpdate, enabled: false }), effect: "updateDatabaseBackup" },
    { name: "remove backup", run: () => actions.removeDatabaseBackupAction("backup"), effect: "removeDatabaseBackup" },
    { name: "create destination", run: () => actions.createDestinationAction(destination), effect: "createDestination" },
    { name: "test destination", run: () => actions.testDestinationAction(destination), effect: "testDestination" },
    { name: "remove destination", run: () => actions.removeDestinationAction("destination"), effect: "removeDestination" },
  ];

  it.each(mutations)("allows $name without a Swarm check", async ({ run, effect }) => {
    expect(await run()).toEqual({ ok: true });
    expect(mocks.dokploy[effect]).toHaveBeenCalledOnce();
    expect(mocks.getHostCapabilities).not.toHaveBeenCalled();
  });

  it("keeps schedules, backups, destinations and backup files readable", async () => {
    mocks.dokploy.listSchedules.mockResolvedValue([]);
    mocks.dokploy.listDatabaseBackups.mockResolvedValue([]);
    mocks.dokploy.listDestinations.mockResolvedValue([]);
    mocks.dokploy.listBackupFiles.mockResolvedValue([]);

    expect(await actions.listSchedulesAction("app")).toEqual({ ok: true, schedules: [] });
    expect(await actions.listDatabaseBackupsAction("postgres", "database")).toEqual({ ok: true, backups: [] });
    expect(await actions.listDestinationsAction()).toEqual({ ok: true, destinations: [] });
    expect(await actions.listBackupFilesAction("destination")).toEqual({ ok: true, files: [] });
    expect(mocks.getHostCapabilities).not.toHaveBeenCalled();
  });
});
