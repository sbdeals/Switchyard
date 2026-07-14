/**
 * Runtime storage for the copilot's Anthropic credential, so users can paste a
 * key in the dashboard UI instead of editing env files. Resolution order:
 * UI-set key first, then the ANTHROPIC_API_KEY env var.
 *
 * Accepts both credential shapes:
 *  - `sk-ant-api...` — a regular Anthropic API key (Console).
 *  - `sk-ant-oat...` — an OAuth access token (Claude subscription, e.g. from
 *    `claude setup-token`); sent as a Bearer token instead of an x-api-key.
 *
 * The UI-set key persists server-side in a 0600 file under the app's home dir
 * (override with SWITCHYARD_AGENT_KEY_FILE) so a dev-server or container
 * restart doesn't lose it. It is never sent to the browser — status endpoints
 * only ever return a masked tail.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const KEY_FILE =
  process.env.SWITCHYARD_AGENT_KEY_FILE?.trim() ||
  path.join(os.homedir(), ".switchyard", "agent-key.json");

interface KeyState {
  loaded: boolean;
  key: string | null;
}

// Survive HMR / repeated imports: one state per process.
const g = globalThis as unknown as { __switchyardAgentKey?: KeyState };
const state: KeyState = (g.__switchyardAgentKey ??= { loaded: false, key: null });

function loadOnce(): void {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")) as { key?: unknown };
    if (typeof raw.key === "string" && raw.key.trim()) state.key = raw.key.trim();
  } catch {
    /* no persisted key */
  }
}

/** Loose shape check — both API keys and OAuth tokens start with sk-ant-. */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{8,}/.test(key.trim());
}

/** Whether a credential is an OAuth access token rather than an API key. */
export function isOAuthToken(key: string): boolean {
  return key.startsWith("sk-ant-oat");
}

/** Store (or clear, with null) the UI-provided credential. */
export function setRuntimeKey(key: string | null): void {
  loadOnce();
  state.key = key?.trim() || null;
  try {
    if (state.key) {
      fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
      fs.writeFileSync(KEY_FILE, JSON.stringify({ key: state.key }), { mode: 0o600 });
    } else {
      fs.rmSync(KEY_FILE, { force: true });
    }
  } catch {
    // In-memory still works for this process; persistence is best-effort
    // (read-only container filesystems).
  }
}

export interface ResolvedKey {
  key: string;
  source: "ui" | "env";
}

/** The active credential: UI-set beats the env var. Null when unconfigured. */
export function resolveAgentKey(): ResolvedKey | null {
  loadOnce();
  if (state.key) return { key: state.key, source: "ui" };
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) return { key: env, source: "env" };
  return null;
}

/** Safe display form: prefix + last 4 chars ("sk-ant-…abcd"). */
export function maskKey(key: string): string {
  const prefix = isOAuthToken(key) ? "sk-ant-oat…" : "sk-ant-…";
  return `${prefix}${key.slice(-4)}`;
}
