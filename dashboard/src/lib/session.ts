/**
 * Switchyard session cookie: a sealed envelope around the CURRENT user's
 * Dokploy session cookie.
 *
 * The dashboard is a backend-for-frontend, so the browser must never see the
 * raw Dokploy cookie. We AES-256-GCM-encrypt a small session payload with a
 * server-only secret (`SWITCHYARD_SESSION_SECRET`) and store the ciphertext in
 * an HttpOnly, SameSite=Lax cookie. GCM's auth tag also makes the cookie
 * tamper-evident, so `openSession` doubles as signature verification.
 *
 * The proxy (src/proxy.ts) only checks for the cookie's *presence* (it mirrors
 * SESSION_COOKIE as a literal to stay crypto-free); real validation happens
 * here, on the request path that actually serves data.
 *
 * KEEP IN SYNC: the desktop app mints this exact cookie format for auto-login
 * (desktop/src/main/autologin.ts) — changing the seal layout, cookie name, or
 * payload shape breaks it.
 */
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Cookie name. Kept in sync with the literal in src/proxy.ts. */
export const SESSION_COOKIE = "switchyard_session";

/** How long a Switchyard session cookie lives (Dokploy's own session may expire sooner). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SwitchyardSession {
  /** The Dokploy session cookie ("name=value; ..."), server-side only. */
  dokployCookie: string;
  /** The Dokploy account email — used for display, not authorization. */
  email: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
}

const IV_LEN = 12;
const TAG_LEN = 16;

/** 32-byte AES key derived from the configured secret (any length in, 256-bit out). */
function key(): Buffer {
  const secret = process.env.SWITCHYARD_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SWITCHYARD_SESSION_SECRET is not set — the dashboard cannot sign session cookies. " +
        "The CLI seeds it automatically; when running from source, set it in .env.local.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

/** Seal a session into a base64url token: base64url(iv | tag | ciphertext). */
export function sealSession(session: SwitchyardSession): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(session), "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

/** Reverse of sealSession. Returns null on any tampering, wrong key, or bad shape. */
export function openSession(token: string | undefined): SwitchyardSession | null {
  if (!token) return null;
  try {
    const buf = Buffer.from(token, "base64url");
    if (buf.length <= IV_LEN + TAG_LEN) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const parsed = JSON.parse(pt.toString("utf8")) as SwitchyardSession;
    if (
      !parsed ||
      typeof parsed.dokployCookie !== "string" ||
      typeof parsed.email !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
