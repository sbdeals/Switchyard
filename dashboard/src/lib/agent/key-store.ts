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

/**
 * Selectable models for the copilot. Default is Opus 4.8 — the most broadly
 * available high-capability tier. (Fable 5 is the most capable overall but, as
 * the newest flagship, is the most likely to return 429 capacity/limit errors
 * on a given key — so it is offered, not the default. When Fable 5 is chosen we
 * add a server-side fallback to Opus 4.8 for safety declines.)
 */
export const AGENT_MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", hint: "Recommended — most available" },
  { id: "claude-fable-5", label: "Claude Fable 5", hint: "Most capable (newest; may rate-limit)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", hint: "Fast, near-Opus quality" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Fastest & cheapest" },
] as const;

export const DEFAULT_AGENT_MODEL = AGENT_MODELS[0].id;

function isKnownModel(id: string): boolean {
  return AGENT_MODELS.some((m) => m.id === id);
}

interface KeyState {
  loaded: boolean;
  key: string | null;
  model: string | null;
}

// Survive HMR / repeated imports: one state per process.
const g = globalThis as unknown as { __switchyardAgentKey?: KeyState };
const state: KeyState = (g.__switchyardAgentKey ??= { loaded: false, key: null, model: null });

function loadOnce(): void {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")) as { key?: unknown; model?: unknown };
    if (typeof raw.key === "string" && raw.key.trim()) state.key = raw.key.trim();
    if (typeof raw.model === "string" && isKnownModel(raw.model)) state.model = raw.model;
  } catch {
    /* no persisted settings */
  }
}

function persist(): void {
  try {
    if (state.key || state.model) {
      fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
      const body: { key?: string; model?: string } = {};
      if (state.key) body.key = state.key;
      if (state.model) body.model = state.model;
      fs.writeFileSync(KEY_FILE, JSON.stringify(body), { mode: 0o600 });
    } else {
      fs.rmSync(KEY_FILE, { force: true });
    }
  } catch {
    // In-memory still works for this process; persistence is best-effort
    // (read-only container filesystems).
  }
}

/** The model the user picked, falling back to the env override, then the default. */
export function resolveAgentModel(): string {
  loadOnce();
  if (state.model && isKnownModel(state.model)) return state.model;
  const env = process.env.SWITCHYARD_AGENT_MODEL?.trim();
  if (env) return env; // allow any env-provided id (advanced/override)
  return DEFAULT_AGENT_MODEL;
}

/** Store (or clear, with null) the chosen model. */
export function setRuntimeModel(model: string | null): void {
  loadOnce();
  state.model = model && isKnownModel(model) ? model : null;
  persist();
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
  persist();
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
