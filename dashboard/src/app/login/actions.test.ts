import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({
  token: undefined as string | undefined,
  forwardedProto: null as string | null,
  set: vi.fn(),
  runExec: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === "switchyard_session" && ctx.token ? { value: ctx.token } : undefined,
    set: ctx.set,
  }),
  headers: async () => new Headers(ctx.forwardedProto === null ? {} : { "x-forwarded-proto": ctx.forwardedProto }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  redirect: ctx.redirect,
}));
vi.mock("@/lib/docker", () => ({ runExec: ctx.runExec }));

let actions: typeof import("./actions");
let session: typeof import("@/lib/session");
let expireSession: typeof import("../api/session/expired/route").GET;
let exec: typeof import("../api/services/exec/route").POST;
const fetchMock = vi.fn<typeof fetch>();
const dokployCookie = "better-auth.session_token=synthetic-user-session";
let signOut: (init: RequestInit) => Response | Promise<Response>;
let revoked: boolean;

async function redirectedTo(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const match = (error as { digest?: string }).digest?.match(/^NEXT_REDIRECT;replace;([^;]+);/);
    if (match) return match[1];
    throw error;
  }
  throw new Error("Expected a redirect");
}

function sealed(iat = Date.now()) {
  return session.sealSession({ dokployCookie, email: "user@example.test", iat });
}

function expectCleared(secure = false) {
  expect(ctx.set).toHaveBeenCalledExactlyOnceWith(session.SESSION_COOKIE, "", {
    httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: 0, expires: new Date(0),
  });
  expect(ctx.redirect).toHaveBeenLastCalledWith("/login");
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DOKPLOY_URL", "http://dokploy.test");
  vi.stubEnv("DOKPLOY_ORIGIN", "http://dokploy-origin.test");
  vi.stubEnv("DOKPLOY_AUTH_ORIGIN", "");
  vi.stubEnv("DOKPLOY_EMAIL", "system@example.test");
  vi.stubEnv("DOKPLOY_PASSWORD", "synthetic-system-password");
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "actions-test-secret");
  vi.stubEnv("SWITCHYARD_ASSUME_HTTPS", "");
  ctx.token = undefined;
  ctx.forwardedProto = null;
  revoked = false;
  signOut = () => { revoked = true; return Response.json({}); };
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin !== "http://dokploy.test") throw new Error("Unexpected test origin");
    if (url.pathname === "/api/auth/sign-in/email") {
      return new Response("{}", { headers: { "set-cookie": `${dokployCookie}; Path=/; HttpOnly` } });
    }
    if (url.pathname === "/api/auth/sign-up/email") return Response.json({});
    expect(new Headers(init.headers).get("cookie")).toBe(dokployCookie);
    if (url.pathname === "/api/auth/sign-out") return signOut(init);
    if (revoked) return new Response(null, { status: 401 });
    if (url.pathname === "/api/project.all") return Response.json([{
      projectId: "user-project", environments: [{ applications: [{ applicationId: "user-app-id" }] }],
    }]);
    if (url.pathname === "/api/application.one") return Response.json({ appName: "user-app" });
    throw new Error("Unexpected test endpoint");
  });
  vi.stubGlobal("fetch", fetchMock);
  session = await import("@/lib/session");
  actions = await import("./actions");
  expireSession = (await import("../api/session/expired/route")).GET;
  exec = (await import("../api/services/exec/route")).POST;
  ctx.runExec.mockResolvedValue({ stdout: "test", stderr: "", exitCode: 0, truncated: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const secureCases = [
  { proto: null, env: "", secure: false },
  { proto: "http", env: "", secure: false },
  { proto: "https", env: "", secure: true },
  { proto: " HTTPS , http", env: "", secure: true },
  { proto: "http, https", env: "", secure: false },
  { proto: null, env: "1", secure: true },
  { proto: null, env: "true", secure: true },
  { proto: "http", env: "1", secure: true },
  { proto: "https", env: "false", secure: true },
];

describe.each(["loginAction", "signupAction"] as const)("%s session cookie", (name) => {
  it.each(secureCases)("sets Secure=$secure for header=$proto and opt-in=$env", async ({ proto, env, secure }) => {
    ctx.forwardedProto = proto;
    vi.stubEnv("SWITCHYARD_ASSUME_HTTPS", env);
    const form = new FormData();
    form.set("name", "Test User");
    form.set("email", "user@example.test");
    form.set("password", "synthetic-user-password");
    expect(await redirectedTo(() => actions[name]({}, form))).toBe("/");
    expect(ctx.set).toHaveBeenCalledExactlyOnceWith(session.SESSION_COOKIE, expect.any(String), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: session.SESSION_MAX_AGE, secure,
    });
    const token = ctx.set.mock.calls[0][1];
    expect(session.openSession(token)).toEqual({ dokployCookie, email: "user@example.test", iat: expect.any(Number) });
    expect(token).not.toContain("synthetic-user-password");
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(
      name === "signupAction" ? ["/api/auth/sign-up/email", "/api/auth/sign-in/email"] : ["/api/auth/sign-in/email"],
    );
  });
});

describe("logoutAction", () => {
  it("posts the user's own cookie to better-auth before clearing locally and redirecting", async () => {
    ctx.token = sealed();
    signOut = () => {
      expect(ctx.set).not.toHaveBeenCalled();
      return Response.json({});
    };
    expect(await redirectedTo(actions.logoutAction)).toBe("/login");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("http://dokploy.test/api/auth/sign-out", {
      method: "POST", body: "{}", cache: "no-store", signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json", Origin: "http://dokploy.test", Cookie: dokployCookie },
    });
    expectCleared();
  });

  it.each(["unreachable", "500", "timeout"])("still clears and redirects on %s without logging secrets", async (failure) => {
    ctx.token = sealed();
    const sensitive = `${dokployCookie} ${ctx.token} synthetic-response-secret`;
    signOut = (init) => {
      if (failure === "500") return new Response(sensitive, { status: 500 });
      if (failure === "unreachable") throw new Error(sensitive);
      return new Promise((_, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error(sensitive)), { once: true });
      });
    };
    if (failure === "timeout") {
      vi.useFakeTimers();
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
      });
    }
    const result = redirectedTo(actions.logoutAction);
    if (failure === "timeout") {
      await vi.advanceTimersByTimeAsync(2_999);
      expect(ctx.set).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(3_000);
    }
    expect(await result).toBe("/login");
    expectCleared();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[logout] Dokploy sign-out failed; clearing the local session anyway.");
    for (const method of [console.log, console.info, console.warn, console.error, console.debug]) {
      const messages = JSON.stringify(vi.mocked(method).mock.calls);
      for (const secret of [dokployCookie, ctx.token, "synthetic-response-secret"]) expect(messages).not.toContain(secret);
    }
  });

  it.each(["missing", "garbage", "tampered", "expired"])("never calls Dokploy for a %s cookie", async (kind) => {
    if (kind === "garbage") ctx.token = "forged-garbage";
    if (kind === "expired") ctx.token = sealed(Date.now() - session.SESSION_MAX_AGE * 1000);
    if (kind === "tampered") {
      const bytes = Buffer.from(sealed(), "base64url");
      bytes[28] ^= 1;
      ctx.token = bytes.toString("base64url");
    }
    expect(await redirectedTo(actions.logoutAction)).toBe("/login");
    expect(fetchMock).not.toHaveBeenCalled();
    expectCleared();
  });

  it("walks INVALID_ORIGIN candidates with the same user cookie and one deadline", async () => {
    ctx.token = sealed();
    signOut = () => fetchMock.mock.calls.length === 1
      ? Response.json({ code: "INVALID_ORIGIN" }, { status: 403 }) : Response.json({});
    expect(await redirectedTo(actions.logoutAction)).toBe("/login");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map(([, init]) => init!);
    expect(new Headers(first.headers).get("origin")).not.toBe(new Headers(second.headers).get("origin"));
    expect(first.signal).toBe(second.signal);
    expectCleared();
  });

  it("bounds a hanging origin retry by three seconds total, including time spent on the first origin", async () => {
    ctx.token = sealed();
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    const signals: AbortSignal[] = [];
    signOut = (init) => {
      const signal = init.signal!;
      signals.push(signal);
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        if (signals.length === 1) {
          setTimeout(() => resolve(Response.json({ code: "INVALID_ORIGIN" }, { status: 403 })), 2_000);
        }
        // The next origin never responds; only the shared abort can finish it.
      });
    };
    const started = Date.now();
    const result = redirectedTo(actions.logoutAction);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const origins = fetchMock.mock.calls.map(([, init]) => new Headers(init!.headers).get("origin"));
    expect(origins[0]).not.toBe(origins[1]);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[1].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(ctx.set).not.toHaveBeenCalled();
    expect(ctx.redirect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(Date.now() - started).toBe(3_000);
    expect(signals[1].aborted).toBe(true);
    expectCleared();
    expect(await result).toBe("/login");
    expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects the old sealed cookie on exec after sign-out, even with a warmed name cache", async () => {
    const token = sealed();
    const request = () => new Request("http://dashboard.test/api/services/exec", {
      method: "POST", headers: { cookie: `${session.SESSION_COOKIE}=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ app: "user-app", command: "echo test" }),
    });
    expect((await exec(request())).status).toBe(200);
    expect(ctx.runExec).toHaveBeenCalledTimes(1);
    ctx.token = token;
    expect(await redirectedTo(actions.logoutAction)).toBe("/login");
    expectCleared();
    vi.clearAllMocks();
    // A copied envelope is still locally decryptable; Dokploy revocation denies it.
    expect(session.openSession(token)).not.toBeNull();
    const response = await exec(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthenticated" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://dokploy.test/api/project.all");
    expect(ctx.runExec).not.toHaveBeenCalled();
  });
});

describe.each([
  { proto: "https", env: "", secure: true },
  { proto: null, env: "1", secure: true },
  { proto: "http", env: "", secure: false },
])("Dokploy-401 cookie recovery ($proto, $env)", ({ proto, env, secure }) => {
  it.each(["request", "restoreBackup"] as const)("clears with matching attributes after %s redirects", async (kind) => {
    ctx.token = sealed();
    revoked = true;
    vi.stubEnv("SWITCHYARD_ASSUME_HTTPS", env);
    const dokploy = await import("@/lib/dokploy");
    const target = await redirectedTo(() => kind === "request"
      ? dokploy.request("project.all")
      : dokploy.restoreBackup({
        databaseId: "user-db-id", engine: "postgres", databaseName: "test-db",
        backupFile: "test-backup.sql", destinationId: "test-destination-id",
      }));
    expect(target).toBe("/api/session/expired");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const response = expireSession(new Request(`http://dashboard.test${target}`, {
      headers: proto === null ? {} : { "x-forwarded-proto": proto },
    }));
    expect(response.cookies.get(session.SESSION_COOKIE)).toMatchObject({
      value: "", httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: 0,
    });
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
    expect(response.headers.get("location")).toBe("http://dashboard.test/login?expired=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe.each(secureCases)("session clearing attributes ($proto, $env)", ({ proto, env, secure }) => {
  it("expires the logout cookie with matching attributes", async () => {
    ctx.forwardedProto = proto;
    vi.stubEnv("SWITCHYARD_ASSUME_HTTPS", env);
    expect(await redirectedTo(actions.logoutAction)).toBe("/login");
    expectCleared(secure);
  });

  it("expires the recovery cookie with matching attributes", () => {
    vi.stubEnv("SWITCHYARD_ASSUME_HTTPS", env);
    const response = expireSession(new Request("http://dashboard.test/api/session/expired", {
      headers: proto === null ? {} : { "x-forwarded-proto": proto },
    }));
    expect(response.cookies.get(session.SESSION_COOKIE)).toMatchObject({
      value: "", httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: 0,
    });
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
    expect(response.headers.get("location")).toBe("http://dashboard.test/login?expired=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
