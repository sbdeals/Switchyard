import { sleep } from "./util.js";

/**
 * Minimal client for the two Dokploy (better-auth) endpoints the installer
 * needs. Both calls require an Origin header (CSRF) — same as the dashboard's
 * BFF client in dashboard/src/lib/dokploy.ts.
 */

function headers(base: string): Record<string, string> {
  return { "Content-Type": "application/json", Origin: base };
}

export async function httpReady(base: string): Promise<boolean> {
  try {
    const res = await fetch(base, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/** Poll until Dokploy serves HTTP (mirrors scripts/lib.sh:wait_dokploy_http). */
export async function waitHttpReady(
  base: string,
  timeoutMs: number,
  onTick?: (elapsedMs: number) => void,
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await httpReady(base)) return true;
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) return false;
    onTick?.(elapsed);
    await sleep(3000);
  }
}

export type SignInResult = "ok" | "invalid" | "unreachable";

export async function signInProbe(base: string, email: string, password: string): Promise<SignInResult> {
  try {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? "ok" : "invalid";
  } catch {
    return "unreachable";
  }
}

/**
 * Sign in and return the session cookie header value ("name=value; ..."), or
 * null when the credentials are rejected or Dokploy is unreachable. Undici
 * folds multiple Set-Cookie headers into one comma-joined string; split on
 * commas that start a new cookie-pair (Expires dates also contain commas).
 */
export async function signInCookie(
  base: string,
  email: string,
  password: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return null;
    return setCookie
      .split(/,(?=\s*[^\s=;,]+=)/)
      .map((c) => (c.split(";")[0] ?? "").trim())
      .filter(Boolean)
      .join("; ");
  } catch {
    return null;
  }
}

/** Authenticated JSON request against Dokploy's REST-mapped API procedures. */
export async function apiRequest<T = unknown>(
  base: string,
  cookie: string,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${base}/api/${path}`, {
    method: init.method ?? "GET",
    headers: { ...headers(base), Cookie: cookie },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`Dokploy ${path} failed (${res.status}): ${body}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export type SignUpResult =
  | { status: "created" }
  | { status: "rejected"; message: string }
  | { status: "unreachable"; message: string };

/**
 * Register the first admin — the call documented (and hand-tested) in
 * docs/getting-started.md: POST /api/auth/sign-up/email {name,email,password}.
 * Dokploy rejects it once an admin exists / registration is closed.
 */
export async function signUp(
  base: string,
  name: string,
  email: string,
  password: string,
): Promise<SignUpResult> {
  try {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify({ name, email, password }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return { status: "created" };
    const body = (await res.text()).slice(0, 300);
    return { status: "rejected", message: `${res.status}: ${body}` };
  } catch (e) {
    return { status: "unreachable", message: e instanceof Error ? e.message : String(e) };
  }
}
