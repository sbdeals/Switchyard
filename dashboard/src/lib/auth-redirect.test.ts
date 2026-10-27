import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ReactElement, ReactNode } from "react";

import { proxy } from "../proxy";
import LoginPage from "../app/login/page";
import { LoginForm } from "../app/login/LoginForm";
import { loginAction, signupAction } from "../app/login/actions";

const mocks = vi.hoisted(() => ({
  getCookie: vi.fn(),
  setCookie: vi.fn(),
  openSession: vi.fn(),
  sealSession: vi.fn(() => "sealed-test-session"),
  signIn: vi.fn(async () => "test-session"),
  signUp: vi.fn(async () => undefined),
  redirect: vi.fn((path: string): never => { throw new Error(`Redirect: ${path}`); }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.getCookie, set: mocks.setCookie }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/dokploy", () => ({
  signInToDokploy: mocks.signIn,
  signUpToDokploy: mocks.signUp,
}));
vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "switchyard_session",
  SESSION_MAX_AGE: 604800,
  openSession: mocks.openSession,
  sealSession: mocks.sealSession,
}));

const deepLink = "/?project=project-1&service=service-1&tab=logs";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openSession.mockReturnValue(null);
  mocks.getCookie.mockReturnValue(undefined);
});

describe("login request gate", () => {
  it("preserves the requested path and query in the login redirect", () => {
    const response = proxy(new NextRequest(`http://localhost:3067${deepLink}`));
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(307);
    expect(location.origin).toBe("http://localhost:3067");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(deepLink);
  });

  it.each([
    new NextRequest("http://localhost:3067/api/services"),
    new NextRequest("http://localhost:3067/", {
      method: "POST",
      headers: { "next-action": "test-action" },
    }),
  ])("keeps unauthenticated APIs and server actions as 401 responses", async (request) => {
    const response = proxy(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "Unauthorized. Sign in at /login." });
  });

  it("allows login and authenticated page requests through", () => {
    for (const request of [
      new NextRequest(`http://localhost:3067/login?next=${encodeURIComponent(deepLink)}`),
      new NextRequest(`http://localhost:3067${deepLink}`, {
        headers: { cookie: "switchyard_session=test-session" },
      }),
    ]) {
      const response = proxy(request);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
  });
});

describe("login return path", () => {
  it.each([deepLink, "//outside.example/path", "https://outside.example/path", "/\\outside.example/path"])(
    "validates the next field on both sign-in and sign-up: %s",
    async (nextPath) => {
      const form = new FormData();
      form.set("name", "Test User");
      form.set("email", "test@example.test");
      form.set("password", "test-password");
      form.set("next", nextPath);
      const expected = nextPath === deepLink ? deepLink : "/";

      for (const action of [loginAction, signupAction]) {
        await expect(action({}, form)).rejects.toThrow(`Redirect: ${expected}`);
        expect(mocks.redirect).toHaveBeenLastCalledWith(expected);
        expect(mocks.setCookie).toHaveBeenLastCalledWith(
          "switchyard_session",
          "sealed-test-session",
          expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
        );
      }
    },
  );

  it("defaults to the workspace when the form has no return path", async () => {
    const form = new FormData();
    form.set("email", "test@example.test");
    form.set("password", "test-password");
    await expect(loginAction({}, form)).rejects.toThrow("Redirect: /");
    expect(mocks.redirect).toHaveBeenLastCalledWith("/");
  });

  it.each([
    [deepLink, deepLink],
    ["//outside.example/path", "/"],
    [[deepLink, "/other"], "/"],
  ])("validates return paths for existing sessions: %s", async (nextPath, expected) => {
    mocks.openSession.mockReturnValue({ email: "test@example.test" });
    await expect(LoginPage({ searchParams: Promise.resolve({ next: nextPath }) }))
      .rejects.toThrow(`Redirect: ${expected}`);
    expect(mocks.redirect).toHaveBeenLastCalledWith(expected);
  });

  it.each([[deepLink, deepLink], ["//outside.example/path", "/"]])(
    "passes the validated return path to the login form: %s",
    async (nextPath, expected) => {
      const page = await LoginPage({ searchParams: Promise.resolve({ next: nextPath }) });
      function findForm(node: ReactNode): ReactElement<{ nextPath: string }> | undefined {
        if (Array.isArray(node)) return node.map(findForm).find(Boolean);
        if (!node || typeof node !== "object" || !("props" in node)) return undefined;
        const element = node as ReactElement<{ children?: ReactNode }>;
        if (element.type === LoginForm) return element as ReactElement<{ nextPath: string }>;
        return findForm(element.props.children);
      }
      expect(findForm(page)?.props.nextPath).toBe(expected);
    },
  );
});
