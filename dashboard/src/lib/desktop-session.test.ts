import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../desktop/src/main/logging.js", () => ({ log: vi.fn() }));

import { establishDashboardSession } from "../../../desktop/src/main/autologin";
import { defaultConfig } from "../../../cli/src/core/config";
import { openSession, SESSION_COOKIE, SESSION_MAX_AGE } from "./session";

beforeEach(() => {
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", "desktop-test-secret");
  vi.stubEnv("SWITCHYARD_ASSUME_HTTPS", "");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
    headers: { "set-cookie": "better-auth.session_token=desktop-test-session; Path=/; HttpOnly" },
  })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("desktop session cookie", () => {
  it.each([
    { assumeHttps: false, env: "" },
    { assumeHttps: true, env: "" },
    { assumeHttps: false, env: "1" },
    { assumeHttps: false, env: "true" },
    { assumeHttps: true, env: "1" },
    { assumeHttps: true, env: "true" },
  ])("keeps the loopback HTTP cookie non-Secure for config=$assumeHttps and env=$env", async ({ assumeHttps, env }) => {
    vi.stubEnv("SWITCHYARD_ASSUME_HTTPS", env);
    const set = vi.fn();
    const electronSession = { cookies: { set } } as unknown as Parameters<typeof establishDashboardSession>[0];
    const cfg = {
      ...defaultConfig("docker-desktop"), assumeHttps,
      sessionSecret: "desktop-test-secret", adminEmail: "desktop@example.test", adminPassword: "test-password",
    };
    expect(await establishDashboardSession(electronSession, cfg)).toBe(true);
    expect(set).toHaveBeenCalledExactlyOnceWith({
      url: "http://127.0.0.1:3001", name: SESSION_COOKIE, value: expect.any(String),
      path: "/", httpOnly: true, sameSite: "lax", expirationDate: expect.any(Number),
    });
    const cookie = set.mock.calls[0][0];
    expect(cookie).not.toHaveProperty("secure");
    const opened = openSession(cookie.value);
    expect(opened).toEqual({
      dokployCookie: "better-auth.session_token=desktop-test-session", email: cfg.adminEmail, iat: expect.any(Number),
    });
    expect(cookie.expirationDate - Math.floor(opened!.iat / 1000)).toBeCloseTo(SESSION_MAX_AGE, -1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
