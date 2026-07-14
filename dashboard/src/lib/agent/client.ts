/**
 * Anthropic client wiring for the embedded deployment copilot.
 *
 * The credential lives only on the server — either pasted in the Agent panel
 * (runtime key store) or the ANTHROPIC_API_KEY env var — and is never sent to
 * the browser. Both regular API keys (sk-ant-api…) and Claude-subscription
 * OAuth tokens (sk-ant-oat…, e.g. from `claude setup-token`) work: OAuth
 * tokens are sent as a Bearer token, API keys as x-api-key. The model is
 * configurable via `SWITCHYARD_AGENT_MODEL` and defaults to Anthropic's most
 * capable model, Claude Fable 5.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  ensureFreshOAuth,
  isOAuthToken,
  resolveAgentKey,
  resolveAgentModel,
  resolveBaseUrl,
  resolveProvider,
  type AgentProvider,
} from "./key-store";

/** Which API dialect the copilot speaks right now. */
export function activeProvider(): AgentProvider {
  return resolveProvider();
}

/** The model in effect right now (UI pick → env override → default Opus 4.8). */
export function agentModel(): string {
  return resolveAgentModel();
}

/**
 * Fable 5 runs safety classifiers that can decline a request. Adding a
 * server-side fallback re-serves a declined turn on Opus 4.8 in the same call.
 * (This does NOT rescue 429s — those are model capacity/limit errors; the fix
 * for those is choosing a more available model in the picker.)
 */
export function fallbackConfig(model: string):
  | { betas: string[]; fallbacks: { model: string }[] }
  | null {
  return model === "claude-fable-5"
    ? { betas: ["server-side-fallback-2026-06-01"], fallbacks: [{ model: "claude-opus-4-8" }] }
    : null;
}

/** Whether the agent is usable at all (i.e. a credential is configured). */
export function isAgentConfigured(): boolean {
  return resolveAgentKey() !== null;
}

/**
 * Refresh the credential if it's a subscription login nearing expiry. Call this
 * before getAnthropic() on the request path; it's a no-op for API keys and
 * still-fresh tokens. getAnthropic() re-keys its cache on the (possibly new)
 * token, so a refresh here transparently rebuilds the client.
 */
export async function ensureAgentCredentialFresh(): Promise<void> {
  await ensureFreshOAuth();
}

let cached: { key: string; client: Anthropic } | null = null;

/** True when the active credential is a Claude-subscription OAuth token. */
export function activeKeyIsOAuth(): boolean {
  const resolved = resolveAgentKey();
  return resolved ? isOAuthToken(resolved.key) : false;
}

/** Lazily construct the Anthropic client. Throws if no credential is set. */
export function getAnthropic(): Anthropic {
  const resolved = resolveAgentKey();
  if (!resolved) {
    throw new Error("No Anthropic API key configured — add one in the Agent panel.");
  }
  if (cached?.key !== resolved.key) {
    cached = {
      key: resolved.key,
      // OAuth tokens (sk-ant-oat…) authenticate as a Bearer token AND require
      // the oauth beta header on /v1/messages; without it the endpoint rejects
      // them. API keys use x-api-key and need neither.
      client: isOAuthToken(resolved.key)
        ? new Anthropic({
            authToken: resolved.key,
            apiKey: null,
            defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
          })
        : new Anthropic({ apiKey: resolved.key }),
    };
  }
  return cached.client;
}

let cachedOpenAI: { key: string; baseUrl: string | null; client: OpenAI } | null = null;

/**
 * Lazily construct an OpenAI-compatible client for the openai provider. `baseURL`
 * points it at whichever endpoint the user chose (OpenRouter, Together, Groq,
 * Nous, or OpenAI itself when unset). Throws if no key is set.
 */
export function getOpenAI(): OpenAI {
  const resolved = resolveAgentKey();
  if (!resolved) {
    throw new Error("No API key configured — add one in the Agent panel.");
  }
  const baseUrl = resolveBaseUrl();
  if (cachedOpenAI?.key !== resolved.key || cachedOpenAI?.baseUrl !== baseUrl) {
    cachedOpenAI = {
      key: resolved.key,
      baseUrl,
      client: new OpenAI({
        apiKey: resolved.key,
        baseURL: baseUrl ?? undefined,
        // OpenRouter uses these for app attribution/rankings; harmless elsewhere.
        defaultHeaders: {
          "HTTP-Referer": "https://github.com/sbdeals/switchyard",
          "X-Title": "Switchyard",
        },
      }),
    };
  }
  return cachedOpenAI.client;
}
