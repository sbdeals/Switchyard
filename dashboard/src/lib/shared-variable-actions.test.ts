import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSharedVariableKeysAction, getSharedVariablesAction, saveSharedVariablesAction } from "../app/shared-variable-actions";
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
const readFailure = { ok: false, error: "Could not load shared variables." };
const saveFailure = { ok: false, error: "Could not save shared variables." };

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

  it("returns only key names for shared reference badges using the user's session", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{
      ...projects[0],
      env: 'TOKEN=shared-project-sentinel\nTOKEN=last-value\nEMPTY=\nMULTI="first\nsecond"\n',
    }]));
    fetchMock.mockResolvedValueOnce(Response.json({ env: "LOCAL=shared-environment-sentinel\n" }));

    const result = await getSharedVariableKeysAction("mine", "development");

    expect(result).toEqual({ ok: true, keys: { project: ["TOKEN", "EMPTY", "MULTI"], environment: ["LOCAL"] } });
    expect(JSON.stringify(result)).not.toMatch(/sentinel|last-value|first|second/);
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/api/project.all", "/api/environment.one",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ Cookie: "test-user-session" });
    }
  });

  it("supports project-only key reads and empty shared blocks", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ ...projects[0], env: null }]));

    await expect(getSharedVariableKeysAction("mine")).resolves.toEqual({
      ok: true, keys: { project: [], environment: [] },
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
    ["unknown", "development"],
    ["mine", "other-environment"],
  ])("refuses value reads, key reads and writes outside the selected project (%s, %s)", async (projectId, environmentId) => {
    await expect(getSharedVariablesAction(projectId, environmentId)).resolves.toEqual(readFailure);
    await expect(getSharedVariableKeysAction(projectId, environmentId)).resolves.toEqual(readFailure);
    for (const scope of ["project", "environment"] as const) {
      await expect(saveSharedVariablesAction(projectId, environmentId, scope, "KEY=value"))
        .resolves.toEqual(saveFailure);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(new URL(String(url)).pathname).toBe("/api/project.all");
      expect(init?.method).toBe("GET");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires a selected environment before writing environment variables", async () => {
    await expect(saveSharedVariablesAction("mine", undefined, "environment", "KEY=value"))
      .resolves.toEqual(saveFailure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects unexpected scope and non-text payloads at runtime without any writes", async () => {
    await expect(saveSharedVariablesAction("mine", "development", "application" as SharedScope, "KEY=value"))
      .resolves.toEqual(saveFailure);
    await expect(saveSharedVariablesAction("mine", "development", "project", {} as string))
      .resolves.toEqual(saveFailure);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([getSharedVariablesAction, getSharedVariableKeysAction])("does not expose backend value-read errors (%#)", async (action) => {
    fetchMock.mockResolvedValueOnce(Response.json(projects));
    fetchMock.mockResolvedValueOnce(new Response("TOKEN=private-backend-sentinel", { status: 500 }));

    await expect(action("mine", "development")).resolves.toEqual(readFailure);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not expose backend ownership-read errors", async () => {
    fetchMock.mockResolvedValue(new Response("TOKEN=private-backend-sentinel", { status: 500 }));

    await expect(getSharedVariablesAction("mine", "development")).resolves.toEqual(readFailure);
    await expect(getSharedVariableKeysAction("mine", "development")).resolves.toEqual(readFailure);
    await expect(saveSharedVariablesAction("mine", "development", "project", "KEY=value"))
      .resolves.toEqual(saveFailure);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not expose a backend write rejection or revalidate", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(projects));
    fetchMock.mockResolvedValueOnce(new Response("TOKEN=private-backend-sentinel", { status: 403 }));
    await expect(saveSharedVariablesAction("mine", "development", "project", "KEY=value"))
      .resolves.toEqual(saveFailure);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves redirects on an expired session and never writes", async () => {
    fetchMock.mockResolvedValue(new Response("Session expired", { status: 401 }));
    await expect(getSharedVariablesAction("mine", "development")).rejects.toBe(mocks.redirect);
    await expect(getSharedVariableKeysAction("mine", "development")).rejects.toBe(mocks.redirect);
    await expect(saveSharedVariablesAction("mine", "development", "project", "KEY=value"))
      .rejects.toBe(mocks.redirect);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not contact Dokploy when there is no user session", async () => {
    mocks.openSession.mockReturnValue(null);
    await expect(getSharedVariablesAction("mine", "development")).rejects.toBe(mocks.redirect);
    await expect(getSharedVariableKeysAction("mine", "development")).rejects.toBe(mocks.redirect);
    await expect(saveSharedVariablesAction("mine", "development", "project", "KEY=value"))
      .rejects.toBe(mocks.redirect);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
