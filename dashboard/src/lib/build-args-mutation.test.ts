import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${path};307;` });
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-session" }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && "digest" in error) throw error;
  },
}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard_session",
  openSession: () => ({ dokployCookie: "test-user=own-session" }),
}));
vi.mock("./docker", () => ({}));
vi.mock("@/lib/dokploy", () => import("./dokploy"));
vi.mock("@/lib/engines", () => import("./engines"));
vi.mock("@/lib/names", () => import("./names"));

import { saveApplicationBuildArgs, saveApplicationEnvironment } from "./dokploy";
import { saveApplicationBuildArgsAction } from "../app/actions";

const ownedTree = [{ environments: [{ applications: [{ applicationId: "owned-app" }] }] }];
const fetchMock = vi.fn<typeof fetch>();

function requests() {
  return fetchMock.mock.calls.map(([url, options]) => ({
    endpoint: new URL(String(url)).pathname,
    method: options?.method,
    cookie: new Headers(options?.headers).get("Cookie"),
    body: options?.body ? JSON.parse(String(options.body)) : undefined,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saveApplicationBuildArgs", () => {
  it("checks the user's projects before updating only build args, preserving their formatting", async () => {
    const raw = '# Public build settings\r\nexport GREETING = "hello # world"\r\nEMPTY=\r\n';
    fetchMock.mockResolvedValueOnce(Response.json(ownedTree)).mockResolvedValueOnce(Response.json({}));

    await saveApplicationBuildArgs("owned-app", raw);

    expect(requests()).toEqual([
      { endpoint: "/api/project.all", method: "GET", cookie: "test-user=own-session", body: undefined },
      {
        endpoint: "/api/application.update",
        method: "POST",
        cookie: "test-user=own-session",
        body: { applicationId: "owned-app", buildArgs: raw },
      },
    ]);
  });

  it("denies an application outside the user's project tree without mutating it", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(ownedTree));

    await expect(saveApplicationBuildArgs("foreign-app", "GREETING=hello")).rejects.toThrow("Application not found");

    expect(requests().map(({ endpoint }) => endpoint)).toEqual(["/api/project.all"]);
  });

  it("rejects malformed arguments without mutating or exposing their values", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(ownedTree));

    await expect(saveApplicationBuildArgs("owned-app", "INVALID NAME=private-value")).rejects.toThrow(
      "Line 1: expected KEY=VALUE with a valid variable name."
    );

    expect(requests().map(({ endpoint }) => endpoint)).toEqual(["/api/project.all"]);
  });

  it("allows clearing all build arguments without deploying", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(ownedTree)).mockResolvedValueOnce(Response.json({}));

    await saveApplicationBuildArgs("owned-app", "");

    expect(requests().map(({ endpoint, body }) => ({ endpoint, body }))).toEqual([
      { endpoint: "/api/project.all", body: undefined },
      { endpoint: "/api/application.update", body: { applicationId: "owned-app", buildArgs: "" } },
    ]);
  });

  it("does not mutate when the ownership lookup fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Unavailable"));

    await expect(saveApplicationBuildArgs("owned-app", "GREETING=hello")).rejects.toThrow("Unavailable");

    expect(requests().map(({ endpoint }) => endpoint)).toEqual(["/api/project.all"]);
  });
});

describe("saveApplicationEnvironment", () => {
  it.each(["GREETING=runtime\n", ""])("patches only runtime variables so build settings survive: %j", async (env) => {
    fetchMock.mockResolvedValueOnce(Response.json({}));

    await saveApplicationEnvironment("owned-app", env);

    expect(requests()).toEqual([{
      endpoint: "/api/application.update",
      method: "POST",
      cookie: "test-user=own-session",
      body: { applicationId: "owned-app", env },
    }]);
  });
});

describe("saveApplicationBuildArgsAction", () => {
  it("revalidates after saving without deploying", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(ownedTree)).mockResolvedValueOnce(Response.json({}));

    await expect(saveApplicationBuildArgsAction("owned-app", "GREETING=hello")).resolves.toEqual({ ok: true });

    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/");
    expect(requests().map(({ endpoint }) => endpoint)).toEqual(["/api/project.all", "/api/application.update"]);
  });

  it("sanitizes upstream failures and never logs submitted values", async () => {
    const logs = ["log", "info", "warn", "error", "debug"] as const;
    const spies = logs.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    fetchMock.mockResolvedValueOnce(Response.json(ownedTree)).mockResolvedValueOnce(
      new Response("Rejected API_TOKEN=private-value", { status: 500 })
    );

    const result = await saveApplicationBuildArgsAction("owned-app", "API_TOKEN=private-value");

    expect(result).toEqual({ ok: false, error: "Could not save build arguments. Check your access and try again." });
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("preserves the login redirect for expired sessions without mutating", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(saveApplicationBuildArgsAction("owned-app", "GREETING=hello")).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/login");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(requests().map(({ endpoint }) => endpoint)).toEqual(["/api/project.all"]);
  });
});
