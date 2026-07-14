/**
 * "Sign in with Claude" — the OAuth 2.0 + PKCE flow that Claude Code itself uses
 * to authenticate a Claude Pro/Max subscription. Switchyard runs the same flow
 * so a user can drive the copilot on their existing Claude subscription instead
 * of a separate pay-as-you-go API key: click sign-in, approve on claude.ai,
 * paste the one-time code back. The resulting sk-ant-oat… access token is used
 * exactly like any subscription token (Bearer + the oauth beta header), and the
 * refresh token keeps it alive across restarts.
 *
 * This deliberately reuses Claude Code's public OAuth client id and its
 * registered console redirect (the same one `claude setup-token` uses). The
 * copilot is Claude Code embedded in the dashboard, so signing in with the
 * Claude Code identity is the point, not a workaround. Claude Code's redirect
 * URIs are fixed, so the console copy-paste callback is the portable choice for
 * a dashboard that may run inside a container with no loopback listener.
 */
import "server-only";
import crypto from "node:crypto";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

const PENDING_TTL_MS = 15 * 60_000;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface PendingLogin {
  verifier: string;
  state: string;
  createdAt: number;
}

// The PKCE challenge lives between /start and /complete. Single-admin dashboard,
// so one pending login at a time (a new /start supersedes any earlier one).
// Kept on globalThis so it survives HMR / repeated module loads in dev.
const g = globalThis as unknown as { __switchyardOAuthPending?: PendingLogin | null };

/** Begin a sign-in: mint a PKCE challenge and return the authorize URL to open. */
export function startLogin(): { url: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  g.__switchyardOAuthPending = { verifier, state, createdAt: Date.now() };

  // Build the query manually with encodeURIComponent. URLSearchParams encodes
  // the spaces in `scope` as "+", which claude.ai's authorize endpoint rejects
  // at grant time with "Authorization failed — Invalid request format".
  // encodeURIComponent uses "%20", the form it accepts (verified end-to-end).
  const query = Object.entries({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return { url: `${AUTHORIZE_URL}?${query}` };
}

export interface OAuthTokens {
  access: string;
  refresh: string;
  expiresAt: number; // epoch ms
}

/** Exchange the one-time code the user pasted back (format `code` or `code#state`). */
export async function completeLogin(rawCode: string): Promise<OAuthTokens> {
  const pending = g.__switchyardOAuthPending;
  if (!pending) {
    throw new Error('No sign-in is in progress — click "Sign in with Claude" first, then paste the code.');
  }
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    g.__switchyardOAuthPending = null;
    throw new Error('That sign-in expired. Click "Sign in with Claude" again.');
  }
  // The console page shows the code as `code#state`; accept either form.
  const [code, statePart] = rawCode.trim().split("#");
  if (!code) throw new Error("Paste the authorization code from the Claude page.");
  const tokens = await exchange({
    grant_type: "authorization_code",
    code,
    state: statePart || pending.state,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: pending.verifier,
  });
  g.__switchyardOAuthPending = null;
  return tokens;
}

/** Trade a refresh token for a fresh access token. */
export async function refreshLogin(refresh: string): Promise<OAuthTokens> {
  return exchange({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: CLIENT_ID,
  });
}

async function exchange(body: Record<string, string>): Promise<OAuthTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Anthropic rejected the sign-in (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}.`,
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("Anthropic did not return an access token.");
  return {
    access: json.access_token,
    refresh: json.refresh_token ?? "",
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}
