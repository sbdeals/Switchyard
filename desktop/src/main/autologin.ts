/**
 * Auto-login handoff: the dashboard's /login gate wants a `switchyard_session`
 * cookie — an AES-256-GCM-sealed envelope around a Dokploy session cookie,
 * keyed by SWITCHYARD_SESSION_SECRET (dashboard/src/lib/session.ts). The
 * desktop app knows the admin credentials AND the session secret (both live in
 * the CLI's config.json), so it can sign into Dokploy and mint that cookie
 * itself, then drop it into Electron's cookie jar. The window opens straight
 * into the workspace — no login screen.
 *
 * KEEP IN SYNC with dashboard/src/lib/session.ts (sealSession format) and
 * dashboard/src/lib/dokploy.ts (signInToDokploy cookie extraction).
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";

import type { Session } from "electron";

import type { SwitchyardConfig } from "../../../cli/src/core/config.js";
import { log } from "./logging.js";

/** Mirror of SESSION_COOKIE / SESSION_MAX_AGE in dashboard/src/lib/session.ts. */
const SESSION_COOKIE = "switchyard_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

interface SwitchyardSession {
  dokployCookie: string;
  email: string;
  iat: number;
}

/** Mirror of sealSession: base64url(iv(12) | gcmTag(16) | ciphertext). */
function sealSession(secret: string, session: SwitchyardSession): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(session), "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

/**
 * Sign into Dokploy and keep just the cookie name=value pairs — the same
 * reduction dashboard/src/lib/dokploy.ts#signInToDokploy performs.
 */
async function dokploySessionCookie(base: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Dokploy sign-in failed (${res.status})`);
  const list = res.headers.getSetCookie();
  if (list.length === 0) throw new Error("Dokploy sign-in returned no session cookie");
  return list.map((c) => (c.split(";")[0] ?? "").trim()).join("; ");
}

/**
 * Mint the dashboard session and store it in the given Electron session's
 * cookie jar for the dashboard origin. Best-effort: on failure the user just
 * sees the normal /login screen (their credentials are in the Ready note).
 */
export async function establishDashboardSession(
  ses: Session,
  cfg: SwitchyardConfig,
): Promise<boolean> {
  try {
    if (!cfg.sessionSecret || !cfg.adminEmail || !cfg.adminPassword) return false;
    const base = `http://localhost:${cfg.dokployPort}`;
    const dokployCookie = await dokploySessionCookie(base, cfg.adminEmail, cfg.adminPassword);
    const token = sealSession(cfg.sessionSecret, {
      dokployCookie,
      email: cfg.adminEmail,
      iat: Date.now(),
    });
    await ses.cookies.set({
      url: `http://127.0.0.1:${cfg.dashboardPort}`,
      name: SESSION_COOKIE,
      value: token,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      expirationDate: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    });
    log(`Auto-login: dashboard session minted for ${cfg.adminEmail}.`);
    return true;
  } catch (e) {
    log(`Auto-login skipped (${e instanceof Error ? e.message : e}) — the /login screen will ask instead.`);
    return false;
  }
}
