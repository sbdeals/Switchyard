import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  workspace: vi.fn(),
  applicationAction: vi.fn(),
  request: vi.fn(),
  listContainers: vi.fn(),
  getContainer: vi.fn(),
  exec: vi.fn(),
  start: vi.fn(),
  inspect: vi.fn(),
}));

vi.mock("./client", () => ({ isAgentConfigured: () => false }));
vi.mock("../dokploy", () => ({
  ENGINES: ["postgres"],
  getDokployRole: mocks.role,
  loadWorkspace: mocks.workspace,
  applicationAction: mocks.applicationAction,
  request: mocks.request,
  DokploySessionExpiredError: class extends Error {},
}));
vi.mock("dockerode", () => ({
  default: class {
    listContainers = mocks.listContainers;
    getContainer = mocks.getContainer;
  },
}));

// Real tool -> queue -> approval route -> operations -> Docker exec helper.
// Only the external Docker/Dokploy transports and credential loader are mocked.
import { DokploySessionExpiredError } from "../dokploy";
import { SESSION_COOKIE, sealSession } from "../session";
import { GET, POST } from "@/app/api/agent/changes/route";
import { addStaged, listStaged, removeStaged, sessionKey, type StagedChange } from "./store";
import { runTool } from "./tools";

const session = { dokployCookie: "sess=shell-fixture", email: "fixture@example.test", iat: Date.now() };
const key = sessionKey(session);
const service = { id: "svc-fixture", name: "Fixture app", appName: "fixture-app", kind: "application" };
const command = "  printf '%s\\n' 'approved once' >> /tmp/proof\n";
const containerId = "a".repeat(64);

function request(body?: unknown, ownSession = session) {
  return new Request("http://dashboard.test/api/agent/changes", {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: `${SESSION_COOKIE}=${sealSession(ownSession)}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function stage(input: Record<string, unknown> = {}) {
  const outcome = await runTool("exec_in_service", { service: service.id, command, workingDir: "/tmp", ...input }, { sessionKey: key });
  expect(outcome.isError).toBeUndefined();
  expect(outcome.staged?.kind).toBe("exec_in_service");
  return outcome.staged!;
}

const approve = (change: StagedChange) => POST(request({ action: "apply", ids: [change.id] }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
  removeStaged(key);
  mocks.role.mockResolvedValue("admin");
  mocks.workspace.mockResolvedValue({ services: [service], projects: [] });
  mocks.listContainers.mockResolvedValue([{ Id: containerId, Names: ["/fixture-app-1"] }]);
  mocks.getContainer.mockReturnValue({
    exec: mocks.exec,
    modem: { demuxStream: (stream: PassThrough, stdout: PassThrough) => stream.pipe(stdout) },
  });
  mocks.exec.mockResolvedValue({ start: mocks.start, inspect: mocks.inspect });
  mocks.start.mockImplementation(async () => {
    const stream = new PassThrough();
    setImmediate(() => stream.end("approved once\n"));
    return stream;
  });
  mocks.inspect.mockResolvedValue({ ExitCode: 0 });
});

afterEach(() => {
  removeStaged(key);
  vi.unstubAllGlobals();
});

describe("shell approval boundary", () => {
  it("stages without exec and exposes the exact command, target and directory for review", async () => {
    const change = await stage();
    expect(listStaged(key)).toEqual([change]);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ configured: false, changes: [{
      id: change.id,
      shell: { command, containerId, serviceId: service.id, serviceName: service.name, appName: service.appName, workingDir: "/tmp" },
    }] });
  });

  it("approves exactly the original string once and returns captured output", async () => {
    const change = await stage();
    const response = await approve(change);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ results: [{ ok: true, output: "stdout:\napproved once\n\n\nexit code: 0" }], remaining: [] });
    expect(mocks.exec).toHaveBeenCalledExactlyOnceWith({
      Cmd: ["sh", "-c", command], WorkingDir: "/tmp",
      AttachStdin: false, AttachStdout: true, AttachStderr: true, Tty: false,
    });
    expect(mocks.getContainer).toHaveBeenCalledExactlyOnceWith(containerId);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.role).toHaveBeenCalledTimes(3); // Route, operation, immediately before exec.start.
    for (const args of mocks.role.mock.calls) expect(args).toEqual([session.dokployCookie]);
    expect((await approve(change)).status).toBe(409);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("rejects without execution and refuses later approval", async () => {
    const change = await stage();
    const response = await POST(request({ action: "discard", ids: [change.id] }));
    expect(await response.json()).toEqual({ discarded: [change.id] });
    expect((await approve(change)).status).toBe(409);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("keeps the exit code visible when displayed output is truncated", async () => {
    const change = await stage();
    mocks.start.mockImplementation(async () => {
      const stream = new PassThrough();
      setImmediate(() => stream.end("x".repeat(13000)));
      return stream;
    });
    mocks.inspect.mockResolvedValue({ ExitCode: 7 });
    const { results } = await (await approve(change)).json();
    expect(results[0].output).toHaveLength(12000 + "\n\nexit code: 7 (output truncated)".length);
    expect(results[0].output).toMatch(/exit code: 7 \(output truncated\)$/);
  });

  it("atomically consumes an approval before concurrent requests can replay it", async () => {
    const change = await stage();
    const responses = await Promise.all([approve(change), approve(change), approve(change)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    { command: "swapped command" }, { containerId: "other-container" }, { workingDir: "/other" },
    { params: { command: "swapped command" } }, { changes: [] },
  ])("refuses client-supplied overrides: %j", async (extra) => {
    const change = await stage();
    const response = await POST(request({ action: "apply", ids: [change.id], ...extra }));
    expect(response.status).toBe(400);
    expect(listStaged(key)).toEqual([change]);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("does not allow returned objects to mutate the approved command or target", async () => {
    const change = await stage();
    if (change.kind !== "exec_in_service") throw new Error("Expected shell change");
    change.params.command = "swapped";
    change.params.containerId = "swapped";
    const listed = listStaged(key);
    listed[0].params.workingDir = "/swapped";
    listed.length = 0;
    await approve(change);
    expect(mocks.exec).toHaveBeenCalledWith(expect.objectContaining({ Cmd: ["sh", "-c", command], WorkingDir: "/tmp" }));
    expect(mocks.getContainer).toHaveBeenCalledWith(containerId);
  });

  it("refuses another session's approval", async () => {
    const change = await stage();
    const response = await POST(request({ action: "apply", ids: [change.id] }, { ...session, dokployCookie: "sess=other" }));
    expect(response.status).toBe(409);
    expect(listStaged(key)).toEqual([change]);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it.each([undefined, [], [42], "all"])("requires explicit reviewed string ids: %j", async (ids) => {
    await stage();
    expect((await POST(request({ action: "apply", ids }))).status).toBe(400);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("rejects duplicates or stale ids without consuming any valid changes", async () => {
    const change = await stage();
    expect((await POST(request({ action: "apply", ids: [change.id, change.id] }))).status).toBe(400);
    expect((await POST(request({ action: "apply", ids: [change.id, "stale"] }))).status).toBe(409);
    expect(listStaged(key)).toEqual([change]);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("does not execute commands staged after the reviewed selection", async () => {
    const reviewed = await stage();
    const later = await stage({ command: "echo later" });
    await approve(reviewed);
    expect(listStaged(key)).toEqual([later]);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it.each(["ps", "env", "cat /etc/os-release", "ls /tmp", "df -h", "ss -ltn", "ls | cat", "ls > /tmp/out", "ps; id", "ps && id", "echo $(id)", "echo `id`"])("requires approval even for diagnostic/shell syntax: %s", async (command) => {
    const change = await stage({ command });
    expect(change.params.command).toBe(command);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it.each([{ command: "" }, { command: " \n" }, { command: "a\0b" }, { workingDir: "relative" }, { workingDir: "/a\0b" }, { workingDir: 12 }])("refuses invalid shell input: %j", async (input) => {
    const outcome = await runTool("exec_in_service", { service: service.id, command, ...input }, { sessionKey: key });
    expect(outcome.isError).toBe(true);
    expect(listStaged(key)).toEqual([]);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("makes the default directory explicit", async () => {
    expect((await stage({ workingDir: undefined })).params.workingDir).toBe("/");
  });

  it("does not stage when no container is running", async () => {
    mocks.listContainers.mockResolvedValue([]);
    const outcome = await runTool("exec_in_service", { service: service.id, command }, { sessionKey: key });
    expect(outcome.isError).toBe(true);
    expect(listStaged(key)).toEqual([]);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("never substitutes a replacement container and consumes failed attempts", async () => {
    const change = await stage();
    mocks.listContainers.mockResolvedValue([{ Id: "replacement", Names: ["/fixture-app-2"] }]);
    mocks.exec.mockRejectedValue(new Error("Approved container no longer exists"));
    expect(await (await approve(change)).json()).toMatchObject({ results: [{ ok: false }], remaining: [] });
    expect(mocks.listContainers).toHaveBeenCalledTimes(1); // Only at staging.
    expect(mocks.getContainer).toHaveBeenCalledExactlyOnceWith(containerId);
    expect((await approve(change)).status).toBe(409);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("never retries an uncertain exec.start failure", async () => {
    const change = await stage();
    mocks.start.mockRejectedValue(new Error("connection lost after starting"));
    expect(await (await approve(change)).json()).toMatchObject({ results: [{ ok: false }], remaining: [] });
    expect((await approve(change)).status).toBe(409);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the service is no longer accessible", async () => {
    const change = await stage();
    mocks.workspace.mockResolvedValue({ services: [], projects: [] });
    expect(await (await approve(change)).json()).toMatchObject({ results: [{ ok: false }], remaining: [] });
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it.each(["revoked", "unavailable"])("revalidates after Docker setup and blocks execution when the session is %s", async (failure) => {
    const change = await stage();
    mocks.exec.mockImplementation(async () => {
      mocks.role.mockRejectedValue(failure === "revoked" ? new DokploySessionExpiredError() : new Error("offline"));
      return { start: mocks.start, inspect: mocks.inspect };
    });
    const body = await (await approve(change)).json();
    expect(body).toMatchObject({ results: [{ ok: false, error: expect.stringContaining(failure === "revoked" ? "Session expired" : "Could not verify") }], remaining: [] });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("checks the session again for the next approved operation", async () => {
    const first = await stage();
    const second = await stage({ command: "echo second" });
    mocks.inspect.mockImplementation(async () => {
      mocks.role.mockRejectedValue(new DokploySessionExpiredError());
      return { ExitCode: 0 };
    });
    const response = await POST(request({ action: "apply", ids: [first.id, second.id] }));
    expect(await response.json()).toMatchObject({ results: [{ ok: true }, { ok: false, error: expect.stringContaining("Session expired") }], remaining: [] });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it.each(["stop_service", "delete_service", "delete_domain", "delete_mount"] as const)("keeps %s approval gated and single-use", async (kind) => {
    const change = addStaged(key, { kind, description: kind, params: { kind: "application", id: service.id, domainId: "domain", mountId: "mount" } });
    expect(mocks.applicationAction).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(await (await approve(change)).json()).toMatchObject({ results: [{ ok: true }], remaining: [] });
    expect((await approve(change)).status).toBe(409);
    expect(mocks.applicationAction.mock.calls.length + mocks.request.mock.calls.length).toBe(1);
  });

  it("also consumes failed destructive approvals instead of silently retrying", async () => {
    const change = addStaged(key, { kind: "stop_service", description: "stop", params: { kind: "application", id: service.id } });
    mocks.applicationAction.mockRejectedValue(new Error("connection lost"));
    expect(await (await approve(change)).json()).toMatchObject({ results: [{ ok: false }], remaining: [] });
    expect((await approve(change)).status).toBe(409);
    expect(mocks.applicationAction).toHaveBeenCalledTimes(1);
  });
});
