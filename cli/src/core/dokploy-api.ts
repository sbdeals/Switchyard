import { UserError } from "./errors.js";
import { sleep } from "./util.js";

/**
 * Minimal Dokploy client shared by the installer and deployment commands.
 * Requests require an Origin header (CSRF) — same as the dashboard's BFF
 * client in dashboard/src/lib/dokploy.ts.
 */

function headers(base: string): Record<string, string> {
  return { "Content-Type": "application/json", Origin: base };
}

export async function httpReady(base: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(base, { redirect: "manual", signal: requestSignal(5000, signal) });
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
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify({ email, password }),
      signal: requestSignal(15000, signal),
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
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${base}/api/${path}`, {
    method: init.method ?? "GET",
    headers: { ...headers(base), Cookie: cookie },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: requestSignal(30000, init.signal),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`Dokploy ${path} failed (${res.status}): ${body}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Dokploy v0.30.10 expects a ZIP in multipart form data. dropDeployment sets
 * sourceType to "drop" and queues a deploy itself; do not call deploy again.
 */
export async function uploadApplication(
  base: string,
  cookie: string,
  applicationId: string,
  archive: Uint8Array,
): Promise<void> {
  const form = new FormData();
  form.set("applicationId", applicationId);
  form.set("zip", new Blob([new Uint8Array(archive)], { type: "application/zip" }), "source.zip");
  form.set("dropBuildPath", "");

  let res: Response;
  try {
    res = await fetch(`${base}/api/application.dropDeployment`, {
      method: "POST",
      // fetch supplies Content-Type together with the multipart boundary.
      headers: { Origin: base, Cookie: cookie },
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new UserError("Upload timed out. Check the dashboard before retrying; Dokploy may have accepted the deployment.");
    }
    throw new UserError(`Cannot upload to Dokploy at ${base}. Check that the platform is running (\`switchyard up\`).`);
  }
  if (res.status === 413) {
    throw new UserError("Upload too large for Dokploy or its proxy. Exclude more files with .gitignore or .dockerignore and retry.");
  }
  if (res.status === 401) {
    throw new UserError("Not logged in to Dokploy (401). Run `switchyard up` to sign in again.");
  }
  if (res.status === 403) {
    throw new UserError("Dokploy denied permission to deploy this application (403).");
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new UserError(`Dokploy upload failed (${res.status}): ${body}`);
  }
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
