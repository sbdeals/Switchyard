/**
 * Anthropic client wiring for the embedded deployment copilot.
 *
 * The API key lives only on the server (env `ANTHROPIC_API_KEY`) and is never
 * sent to the browser. The model is configurable via `SWITCHYARD_AGENT_MODEL`
 * and defaults to Anthropic's most capable model, Claude Fable 5.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const AGENT_MODEL = process.env.SWITCHYARD_AGENT_MODEL?.trim() || "claude-fable-5";

/** Whether the agent is usable at all (i.e. an API key is configured). */
export function isAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

let cached: Anthropic | null = null;

/** Lazily construct the Anthropic client. Throws if the key is missing. */
export function getAnthropic(): Anthropic {
  if (!isAgentConfigured()) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  cached ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cached;
}
