"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/deeplink";
import { signInToDokploy, signOutOfDokploy, signUpToDokploy } from "@/lib/dokploy";
import { SESSION_COOKIE, SESSION_MAX_AGE, openSession, sealSession } from "@/lib/session";
import { shouldSecureCookie } from "@/lib/session-cookie";

export interface LoginState {
  error?: string;
}

async function cookieSecure(): Promise<boolean> {
  return shouldSecureCookie(
    (await headers()).get("x-forwarded-proto"),
    process.env.SWITCHYARD_ASSUME_HTTPS,
  );
}

/**
 * Sign into Dokploy with the user's credentials, seal the returned Dokploy
 * cookie inside our HttpOnly Switchyard session cookie, and land on the
 * workspace. The raw Dokploy cookie never reaches the browser. Shared tail of
 * both actions below.
 *
 * This file is the ONLY module the /login route imports for its Server Action
 * surface, so an unauthenticated POST to /login can reach nothing but these
 * actions.
 */
async function establishSession(email: string, password: string, nextPath: unknown): Promise<LoginState> {
  let dokployCookie: string;
  try {
    dokployCookie = await signInToDokploy(email, password);
  } catch {
    // Deliberately vague — don't distinguish "no such user" from "bad password".
    return { error: "Sign-in failed. Check your Dokploy email and password." };
  }

  let token: string;
  try {
    token = sealSession({ dokployCookie, email, iat: Date.now() });
  } catch {
    return { error: "Server session secret is not configured. Contact your administrator." };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: await cookieSecure(),
  });

  // Outside the try/catch: redirect() throws NEXT_REDIRECT by design.
  redirect(safeNextPath(nextPath));
}

/** Sign in with the user's OWN Dokploy account. */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Enter your Dokploy email and password." };
  }
  return establishSession(email, password, formData.get("next"));
}

/**
 * Create a Dokploy account, then sign straight in. On a fresh install the
 * first sign-up becomes the admin (same endpoint the CLI's terminal-guided
 * registration uses); once registration is closed Dokploy rejects it.
 */
export async function signupAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name || !email || !password) {
    return { error: "Enter a name, email, and password." };
  }
  if (password.length < 8) {
    return { error: "Use at least 8 characters for the password." };
  }

  try {
    await signUpToDokploy(name, email, password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      error: /\(4\d\d\)/.test(msg)
        ? "Dokploy rejected the sign-up — an account may already exist or registration is closed. Sign in instead, or ask your admin for an invite."
        : "Sign-up failed. Is Dokploy running and reachable?",
    };
  }
  return establishSession(email, password, formData.get("next"));
}

/** Revoke the user's Dokploy session, then clear the browser cookie even on failure. */
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const session = openSession(store.get(SESSION_COOKIE)?.value);
  if (session) {
    try {
      await signOutOfDokploy(session.dokployCookie);
    } catch {
      // Neither upstream bodies nor thrown errors are safe to log with credentials.
      console.warn("[logout] Dokploy sign-out failed; clearing the local session anyway.");
    }
  }
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await cookieSecure(),
    maxAge: 0,
    expires: new Date(0),
  });
  redirect("/login");
}
