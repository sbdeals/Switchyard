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
import { refreshLogin } from "./oauth";

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

export type AgentProvider = "anthropic" | "openai";

interface CredentialBinding {
  provider: AgentProvider;
  baseUrl: string;
}

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Canonical API base (including its path); local model servers may use HTTP. */
export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid base URL.");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Base URL must use HTTPS (HTTP is allowed only for loopback model servers).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Base URL must not contain credentials, a query, or a fragment.");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

interface KeyState {
  loaded: boolean;
  key: string | null;
  binding: CredentialBinding | null;
  // A deliberate removal/endpoint change must not resurrect an env credential.
  keyDisabled: boolean;
  model: string | null;
  // "anthropic" (default) drives the Anthropic Messages API. "openai" drives
  // any OpenAI-compatible /chat/completions endpoint (OpenRouter, Together,
  // Groq, Nous, …) via `baseUrl`, letting users bring a cheap key + open model.
  provider: AgentProvider | null;
  baseUrl: string | null;
  // Present only when `key` came from the "Sign in with Claude" flow: the
  // refresh token + access-token expiry that let us keep it fresh. A pasted
  // key/token has these null.
  oauthRefresh: string | null;
  oauthExpiresAt: number | null;
}

// Survive HMR / repeated imports: one state per process.
const g = globalThis as unknown as { __switchyardAgentKey?: KeyState };
const state: KeyState = (g.__switchyardAgentKey ??= {
  loaded: false,
  key: null,
  binding: null,
  keyDisabled: false,
  model: null,
  provider: null,
  baseUrl: null,
  oauthRefresh: null,
  oauthExpiresAt: null,
});

function loadOnce(): void {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")) as {
      key?: unknown;
      binding?: unknown;
      keyDisabled?: unknown;
      model?: unknown;
      provider?: unknown;
      baseUrl?: unknown;
      oauth?: unknown;
    };
    if (typeof raw.key === "string" && raw.key.trim()) state.key = raw.key.trim();
    // Model is free-text for the openai provider, so don't gate it on the
    // Anthropic catalog here — resolveAgentModel() does provider-aware fallback.
    if (typeof raw.model === "string" && raw.model.trim()) state.model = raw.model.trim();
    if (raw.provider === "anthropic" || raw.provider === "openai") state.provider = raw.provider;
    if (typeof raw.baseUrl === "string" && raw.baseUrl.trim()) state.baseUrl = raw.baseUrl.trim();
    state.keyDisabled = raw.keyDisabled === true;
    if (raw.oauth && typeof raw.oauth === "object") {
      const o = raw.oauth as { refresh?: unknown; expiresAt?: unknown };
      if (typeof o.refresh === "string" && o.refresh) state.oauthRefresh = o.refresh;
      if (typeof o.expiresAt === "number") state.oauthExpiresAt = o.expiresAt;
    }
    if (raw.binding === undefined && state.key) {
      // Legacy keys belonged to the configuration loaded with them. Persist that
      // binding now so later restarts/env changes cannot silently rebind them.
      state.binding = currentBinding();
      persist();
    } else if (raw.binding && typeof raw.binding === "object") {
      const binding = raw.binding as { provider?: unknown; baseUrl?: unknown };
      if ((binding.provider === "anthropic" || binding.provider === "openai") && typeof binding.baseUrl === "string") {
        state.binding = { provider: binding.provider, baseUrl: normalizeBaseUrl(binding.baseUrl) };
      }
    }
  } catch {
    /* no persisted settings */
  }
}

function persist(): void {
  try {
    if (state.key || state.keyDisabled || state.model || state.provider || state.baseUrl || state.oauthRefresh) {
      fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
      const body: {
        key?: string;
        binding?: CredentialBinding | null;
        keyDisabled?: boolean;
        model?: string;
        provider?: AgentProvider;
        baseUrl?: string;
        oauth?: { refresh: string; expiresAt: number | null };
      } = {};
      if (state.key) {
        body.key = state.key;
        body.binding = state.binding ?? null;
      }
      if (state.keyDisabled) body.keyDisabled = true;
      if (state.model) body.model = state.model;
      if (state.provider) body.provider = state.provider;
      if (state.baseUrl) body.baseUrl = state.baseUrl;
      if (state.oauthRefresh) {
        body.oauth = { refresh: state.oauthRefresh, expiresAt: state.oauthExpiresAt };
      }
      fs.writeFileSync(KEY_FILE, JSON.stringify(body), { mode: 0o600 });
    } else {
      fs.rmSync(KEY_FILE, { force: true });
    }
  } catch {
    // In-memory still works for this process; persistence is best-effort
    // (read-only container filesystems).
  }
}

/** Active provider: UI pick → env override → "anthropic". */
export function resolveProvider(): AgentProvider {
  loadOnce();
  if (state.provider) return state.provider;
  const env = process.env.SWITCHYARD_AGENT_PROVIDER?.trim();
  return env === "openai" ? "openai" : "anthropic";
}

/** Base URL for the openai provider (OpenAI-compatible endpoint). Null otherwise. */
export function resolveBaseUrl(): string | null {
  loadOnce();
  return state.baseUrl || process.env.SWITCHYARD_AGENT_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim() || null;
}

function currentBinding(): CredentialBinding {
  const provider = resolveProvider();
  return {
    provider,
    baseUrl: normalizeBaseUrl(provider === "openai"
      ? resolveBaseUrl() || OPENAI_BASE_URL
      : process.env.ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_BASE_URL),
  };
}

function bindingMatches(binding: CredentialBinding | null): boolean {
  try {
    const current = currentBinding();
    return binding?.provider === current.provider && binding.baseUrl === current.baseUrl;
  } catch {
    return false; // An unsafe/invalid persisted endpoint cannot receive a key.
  }
}

function clearCredential(): void {
  state.key = null;
  state.binding = null;
  state.keyDisabled = true;
  state.oauthRefresh = null;
  state.oauthExpiresAt = null;
}

/**
 * The model in effect. For openai it's the user's free-text id (any string the
 * provider serves); for anthropic it's validated against AGENT_MODELS with a
 * safe default. Returns "" only for openai with nothing chosen yet.
 */
export function resolveAgentModel(): string {
  loadOnce();
  const env = process.env.SWITCHYARD_AGENT_MODEL?.trim();
  if (resolveProvider() === "openai") {
    return state.model || env || "";
  }
  if (state.model && isKnownModel(state.model)) return state.model;
  if (env) return env; // allow any env-provided id (advanced/override)
  return DEFAULT_AGENT_MODEL;
}

/** Store (or clear, with null) the chosen model. Free-text (validated per provider by callers). */
export function setRuntimeModel(model: string | null): void {
  loadOnce();
  state.model = model?.trim() || null;
  persist();
}

/** Switch provider. A different provider requires an explicit new credential. */
export function setProvider(provider: AgentProvider | null): void {
  loadOnce();
  const previous = resolveProvider();
  state.provider = provider === "openai" || provider === "anthropic" ? provider : null;
  if (previous !== resolveProvider()) {
    state.model = null;
    clearCredential();
  }
  persist();
}

/** Store (or clear, with null) the OpenAI-compatible base URL. */
export function setBaseUrl(url: string | null): void {
  loadOnce();
  const next = url?.trim() ? normalizeBaseUrl(url) : null;
  const fallback = process.env.SWITCHYARD_AGENT_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim() || OPENAI_BASE_URL;
  const endpoint = normalizeBaseUrl(next || fallback);
  let previous: string | null = null;
  try {
    previous = normalizeBaseUrl(resolveBaseUrl() || OPENAI_BASE_URL);
  } catch {
    // Allow an admin to replace an unsafe legacy endpoint, dropping its key.
  }
  state.baseUrl = next;
  if (previous !== endpoint) clearCredential();
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

/** Store (or clear, with null) a pasted credential. Clears any subscription login. */
export function setRuntimeKey(key: string | null): void {
  loadOnce();
  const value = key?.trim() || null;
  const binding = value ? currentBinding() : null;
  clearCredential();
  state.key = value;
  state.binding = binding;
  state.keyDisabled = !value;
  persist();
}

/** Store the tokens from a "Sign in with Claude" flow (access + refresh + expiry). */
export function setOAuthCredential(t: { access: string; refresh: string; expiresAt: number }): void {
  loadOnce();
  const binding: CredentialBinding = { provider: "anthropic", baseUrl: ANTHROPIC_BASE_URL };
  if (!bindingMatches(binding)) {
    throw new Error("Select Anthropic's default endpoint before connecting Claude.");
  }
  state.key = t.access;
  state.binding = binding;
  state.keyDisabled = false;
  state.oauthRefresh = t.refresh || null;
  state.oauthExpiresAt = t.expiresAt;
  persist();
}

/** True when the active credential came from the subscription sign-in (refreshable). */
export function isLoginCredential(): boolean {
  loadOnce();
  return state.oauthRefresh != null && bindingMatches(state.binding);
}

/**
 * If the active credential is a subscription login nearing expiry, refresh it in
 * place. No-op for API keys, pasted tokens, or a token that's still fresh. Best
 * effort — on failure we keep the current token and let any 401 surface on use.
 */
export async function ensureFreshOAuth(): Promise<void> {
  loadOnce();
  if (!state.oauthRefresh) return;
  if (state.binding?.provider !== "anthropic" || !bindingMatches(state.binding)) return;
  if (state.oauthExpiresAt && Date.now() < state.oauthExpiresAt - 120_000) return;
  const { key, binding, oauthRefresh } = state;
  try {
    const t = await refreshLogin(oauthRefresh);
    // Configuration/removal may have changed while the exchange was in flight.
    if (state.key !== key || state.binding !== binding || state.oauthRefresh !== oauthRefresh || !bindingMatches(binding)) return;
    state.key = t.access;
    if (t.refresh) state.oauthRefresh = t.refresh; // some refreshes rotate it, some don't
    state.oauthExpiresAt = t.expiresAt;
    persist();
  } catch {
    /* keep existing token */
  }
}

export interface ResolvedKey extends CredentialBinding {
  key: string;
  source: "ui" | "env";
}

/** The active credential: UI-set beats the env var. Null when unconfigured. */
export function resolveAgentKey(): ResolvedKey | null {
  loadOnce();
  if (state.key) {
    return state.binding && bindingMatches(state.binding)
      ? { key: state.key, source: "ui", ...state.binding }
      : null;
  }
  if (state.keyDisabled) return null;
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) {
    // Env credentials belong to the env configuration, never a later UI pick.
    const provider = process.env.SWITCHYARD_AGENT_PROVIDER?.trim() === "openai" ? "openai" : "anthropic";
    try {
      const binding: CredentialBinding = {
        provider,
        baseUrl: normalizeBaseUrl(provider === "openai"
          ? process.env.SWITCHYARD_AGENT_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim() || OPENAI_BASE_URL
          : process.env.ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_BASE_URL),
      };
      if (bindingMatches(binding)) return { key: env, source: "env", ...binding };
    } catch {
      /* unsafe env endpoint */
    }
  }
  return null;
}

/**
 * Safe display form: real leading chars + last 4 ("sk-or-v1…abcd"). Generic so
 * it reads correctly for any provider's key format (sk-ant-, sk-or-, gsk_, …).
 */
export function maskKey(key: string): string {
  const head = key.slice(0, Math.min(8, Math.max(0, key.length - 4)));
  return `${head}…${key.slice(-4)}`;
}
