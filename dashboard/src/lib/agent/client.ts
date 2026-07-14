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
import { isOAuthToken, resolveAgentKey } from "./key-store";

export const AGENT_MODEL = process.env.SWITCHYARD_AGENT_MODEL?.trim() || "claude-fable-5";

/** Whether the agent is usable at all (i.e. a credential is configured). */
export function isAgentConfigured(): boolean {
  return resolveAgentKey() !== null;
}

let cached: { key: string; client: Anthropic } | null = null;

/** Lazily construct the Anthropic client. Throws if no credential is set. */
export function getAnthropic(): Anthropic {
  const resolved = resolveAgentKey();
  if (!resolved) {
    throw new Error("No Anthropic API key configured — add one in the Agent panel.");
  }
  if (cached?.key !== resolved.key) {
    cached = {
      key: resolved.key,
      client: isOAuthToken(resolved.key)
        ? new Anthropic({ authToken: resolved.key, apiKey: null })
        : new Anthropic({ apiKey: resolved.key }),
    };
  }
  return cached.client;
}
