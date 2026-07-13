"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { signInToDokploy } from "@/lib/dokploy";
import { SESSION_COOKIE, SESSION_MAX_AGE, sealSession } from "@/lib/session";

export interface LoginState {
  error?: string;
}

/**
 * Sign in with the user's OWN Dokploy account. We POST their credentials to
 * Dokploy (same call the BFF makes), capture the returned Dokploy session
 * cookie, and seal it inside our HttpOnly Switchyard session cookie — the raw
 * Dokploy cookie never reaches the browser.
 *
 * This file is the ONLY module the /login route imports for its Server Action
 * surface, so an unauthenticated POST to /login can reach nothing but these
 * two actions.
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Enter your Dokploy email and password." };
  }

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
  });

  // Outside the try/catch: redirect() throws NEXT_REDIRECT by design.
  redirect("/");
}

/** Clear the session and return to the login screen. */
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
