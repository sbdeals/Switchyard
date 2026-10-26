import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSharedVariablesAction, saveSharedVariablesAction } from "../app/shared-variable-actions";
import type { SharedScope } from "./shared-variables";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  openSession: vi.fn(),
  redirect: new Error("NEXT_REDIRECT"),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-session" }) }) }));
vi.mock("next/navigation", () => ({
  redirect: () => { throw mocks.redirect; },
  unstable_rethrow: (error: unknown) => { if (error === mocks.redirect) throw error; },
}));
vi.mock("./session", () => ({ SESSION_COOKIE: "session", openSession: mocks.openSession }));
vi.mock("./docker", () => ({}));

const projects = [
  {
    projectId: "mine",
    env: "PROJECT_KEY=project-value\n",
    environments: [{ environmentId: "development" }, { environmentId: "production" }],
  },
  {
    projectId: "other",
    env: "UNRELATED=hidden",
    environments: [{ environmentId: "other-environment" }],
  },
];

describe("shared variable actions", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    mocks.openSession.mockReturnValue({ dokployCookie: "test-user-session" });
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("project.all")) return Response.json(projects);
      if (path.endsWith("environment.one")) {
        return Response.json({ env: "ENV_KEY=environment-value\n", project: projects[0] });
      }
      return Response.json({});
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("returns only the chosen project and environment blocks using the user's session", async () => {
    await expect(getSharedVariablesAction("mine", "development")).resolves.toEqual({
      ok: true,
      variables: { project: projects[0].env, environment: "ENV_KEY=environment-value\n" },
    });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/api/project.all", "/api/environment.one",
    ]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("environmentId=development");
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ Cookie: "test-user-session" });
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("supports project-only reads without fetching an environment", async () => {
    await expect(getSharedVariablesAction("mine")).resolves.toEqual({
      ok: true, variables: { project: projects[0].env, environment: "" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes unset shared blocks to empty text", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ ...projects[0], env: null }]));
    fetchMock.mockResolvedValueOnce(Response.json({ env: null }));
    await expect(getSharedVariablesAction("mine", "development")).resolves.toEqual({
      ok: true, variables: { project: "", environment: "" },
    });
  });

  it.each(["project", "environment"] as const)("saves %s variables verbatim after authorization", async (scope) => {
    const env = '# comment\nVALUE="first\nsecond"\nDUP=one\nDUP=two\n';
    await expect(saveSharedVariablesAction("mine", "development", scope, env)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/project.all");
    const [url, init] = fetchMock.mock.calls[1];
    expect(new URL(String(url)).pathname).toBe(`/api/${scope}.update`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(scope === "project"
      ? { projectId: "mine", env }
      : { environmentId: "development", env });
    expect(init?.headers).toMatchObject({ Cookie: "test-user-session" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it.each([
    ["unknown", "development", "Project not found or access denied."],
    ["mine", "other-environment", "Environment does not belong to this project."],
  ])("refuses reads and writes outside the selected project (%s, %s)", async (projectId, environmentId, error) => {
    await expect(getSharedVariablesAction(projectId, environmentId)).resolves.toEqual({ ok: false, error });
    for (const scope of ["project", "environment"] as const) {
      await expect(saveSharedVariablesAction(projectId, environmentId, scope, "KEY=value"))
        .resolves.toEqual({ ok: false, error });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(new URL(String(url)).pathname).toBe("/api/project.all");
      expect(init?.method).toBe("GET");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires a selected environment before writing environment variables", async () => {
    await expect(saveSharedVariablesAction("mine", undefined, "environment", "KEY=value"))
      .resolves.toEqual({ ok: false, error: "Select an environment first." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects unexpected scope and non-text payloads at runtime without any writes", async () => {
    await expect(saveSharedVariablesAction("mine", "development", "application" as SharedScope, "KEY=value"))
      .resolves.toEqual({ ok: false, error: "Invalid shared variable scope." });
    await expect(saveSharedVariablesAction("mine", "development", "project", {} as string))
      .resolves.toEqual({ ok: false, error: "Variables must be text." });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces a backend write rejection without revalidating", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(projects));
    fetchMock.mockResolvedValueOnce(new Response("Permission denied", { status: 403 }));
    await expect(saveSharedVariablesAction("mine", "development", "project", "KEY=value"))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining("Permission denied") });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves redirects on an expired session and never writes", async () => {
    fetchMock.mockResolvedValue(new Response("Session expired", { status: 401 }));
    await expect(getSharedVariablesAction("mine", "development")).rejects.toBe(mocks.redirect);
    await expect(saveSharedVariablesAction("mine", "development", "project", "KEY=value"))
      .rejects.toBe(mocks.redirect);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not contact Dokploy when there is no user session", async () => {
    mocks.openSession.mockReturnValue(null);
    await expect(saveSharedVariablesAction("mine", "development", "project", "KEY=value"))
      .rejects.toBe(mocks.redirect);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
