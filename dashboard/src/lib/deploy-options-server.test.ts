import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDeployOptions, loadWorkspace } from "./dokploy";
import { deployOptionsAction } from "../app/deploy-actions";
import type { DeployOptionsRequest } from "./deploy-options";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  openSession: vi.fn(),
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  unstable_rethrow: mocks.unstable_rethrow,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./session", () => ({ SESSION_COOKIE: "test-session", openSession: mocks.openSession }));
vi.mock("./docker", () => ({
  listRuntimeStates: vi.fn().mockResolvedValue({ compose: new Map(), swarm: new Map() }),
  deriveComposeRuntime: vi.fn(),
  deriveSwarmRuntime: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();
const redirectError = new Error("test redirect");
const tree = [{
  projectId: "project-1",
  name: "Test project",
  environments: [{
    environmentId: "environment-1",
    name: "Test environment",
    applications: [{ applicationId: "app-1" }],
  }],
}];

function respond(...values: unknown[]) {
  for (const value of values) fetchMock.mockResolvedValueOnce(Response.json(value));
}

function mutationCalls() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("Unexpected request"));
  vi.stubGlobal("fetch", fetchMock);
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "sealed-test-session" }) });
  mocks.openSession.mockReturnValue({ dokployCookie: "test-user-session" });
  mocks.redirect.mockImplementation(() => { throw redirectError; });
  mocks.unstable_rethrow.mockImplementation((error: unknown) => {
    if (error === redirectError) throw error;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyDeployOptions", () => {
  it("rejects an application outside the user's project tree before reading or mutating it", async () => {
    respond(tree);

    await expect(applyDeployOptions("other-app", { kind: "redeploy" })).rejects.toThrow("Unknown application");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/project\.all$/);
    expect(mutationCalls()).toHaveLength(0);
  });

  it("fails closed when the ownership lookup fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));

    await expect(applyDeployOptions("app-1", { kind: "redeploy" })).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mutationCalls()).toHaveLength(0);
  });

  it("redirects missing sessions without making an API request", async () => {
    mocks.openSession.mockReturnValue(null);

    await expect(applyDeployOptions("app-1", { kind: "redeploy" })).rejects.toBe(redirectError);

    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects an expired Dokploy session without falling back to another account", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(applyDeployOptions("app-1", { kind: "redeploy" })).rejects.toBe(redirectError);

    expect(mocks.redirect).toHaveBeenCalledWith("/api/session/expired");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mutationCalls()).toHaveLength(0);
  });

  it.each<DeployOptionsRequest>([
    { kind: "deploy" },
    { kind: "redeploy" },
    { kind: "message", title: "Release", description: "Details" },
    { kind: "clean-cache", enabled: true },
  ])("rejects a running application's $kind option", async (input) => {
    respond(tree, { applicationStatus: "running", sourceType: "git" });

    await expect(applyDeployOptions("app-1", input)).rejects.toThrow("Application is not ready");

    expect(mutationCalls()).toHaveLength(0);
  });

  it.each(["docker", null])("rejects cache changes for source %s", async (sourceType) => {
    respond(tree, { applicationStatus: "done", sourceType });

    await expect(applyDeployOptions("app-1", { kind: "clean-cache", enabled: true })).rejects.toThrow("Application is not ready");

    expect(mutationCalls()).toHaveLength(0);
  });

  it.each<DeployOptionsRequest>([
    { kind: "redeploy" },
    { kind: "message", title: "Release", description: "Details" },
  ])("rejects an idle application's $kind option before source has been deployed", async (input) => {
    respond(tree, { applicationStatus: "idle", sourceType: "git" });

    await expect(applyDeployOptions("app-1", input)).rejects.toThrow("Application is not ready");

    expect(mutationCalls()).toHaveLength(0);
  });

  it("allows an idle application's initial deploy", async () => {
    respond(tree, { applicationStatus: "idle", sourceType: "git" }, true);

    await applyDeployOptions("app-1", { kind: "deploy" });

    expect(mutationCalls()).toHaveLength(1);
    expect(mutationCalls()[0][0]).toMatch(/\/api\/application\.deploy$/);
    expect(JSON.parse(mutationCalls()[0][1]!.body as string)).toEqual({ applicationId: "app-1" });
  });

  it.each([true, false])("only saves cleanCache=%s without deploying", async (enabled) => {
    respond(tree, { applicationStatus: "error", sourceType: "git" }, true);

    await applyDeployOptions("app-1", { kind: "clean-cache", enabled });

    expect(mutationCalls()).toHaveLength(1);
    expect(mutationCalls()[0][0]).toMatch(/\/api\/application\.update$/);
    expect(JSON.parse(mutationCalls()[0][1]!.body as string)).toEqual({ applicationId: "app-1", cleanCache: enabled });
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ Cookie: "test-user-session" });
    }
  });

  it("forwards the message to redeploy after ownership and status checks", async () => {
    respond(tree, { applicationStatus: "done", sourceType: "git" }, true);

    await applyDeployOptions("app-1", { kind: "message", title: " Release ", description: " Build details " });

    expect(fetchMock.mock.calls.map(([url]) => String(url).split("/api/")[1])).toEqual([
      "project.all", "application.one?applicationId=app-1", "application.redeploy",
    ]);
    expect(JSON.parse(mutationCalls()[0][1]!.body as string)).toEqual({
      applicationId: "app-1", title: "Release", description: "Build details",
    });
  });
});

describe("deployOptionsAction", () => {
  it("revalidates the workspace after a successful mutation", async () => {
    respond(tree, { applicationStatus: "done", sourceType: "git" }, true);

    await expect(deployOptionsAction("app-1", { kind: "redeploy" })).resolves.toEqual({ ok: true });

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mutationCalls()).toHaveLength(1);
  });

  it("returns a generic error without exposing backend details", async () => {
    respond(tree, { applicationStatus: "done", sourceType: "git" });
    fetchMock.mockResolvedValueOnce(new Response("private backend detail", { status: 500 }));

    await expect(deployOptionsAction("app-1", { kind: "redeploy" })).resolves.toEqual({
      ok: false, error: "Could not apply deployment option. Please try again.",
    });

    expect(mocks.unstable_rethrow).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves Next.js authentication redirects", async () => {
    mocks.openSession.mockReturnValue(null);

    await expect(deployOptionsAction("app-1", { kind: "redeploy" })).rejects.toBe(redirectError);

    expect(mocks.unstable_rethrow).toHaveBeenCalledWith(redirectError);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deploy options workspace data", () => {
  it("retains the persistent cache setting and deployment description", async () => {
    respond(tree, {
      cleanCache: true,
      deployments: [{ deploymentId: "deployment-1", title: "Release", description: "Build details" }],
    });

    const { services } = await loadWorkspace();

    expect(services[0]).toMatchObject({
      cleanCache: true,
      deployments: [{ deploymentId: "deployment-1", title: "Release", description: "Build details" }],
    });
  });

  it("defaults absent cache and description fields", async () => {
    respond(tree, { deployments: [{ deploymentId: "deployment-1" }] });

    const { services } = await loadWorkspace();

    expect(services[0]).toMatchObject({
      cleanCache: false,
      deployments: [{ deploymentId: "deployment-1", description: null }],
    });
  });
});
