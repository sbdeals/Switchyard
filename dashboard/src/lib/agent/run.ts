/**
 * The server-side tool-use loop for one assistant turn. Streams the assistant's
 * text and per-tool activity out through `emit` so the API route can forward it
 * to the browser as SSE. Destructive tools stage changes rather than executing;
 * everything else runs against Dokploy immediately.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  getAnthropic,
  agentModel,
  fallbackConfig,
  activeKeyIsOAuth,
  activeProvider,
  ensureAgentCredentialFresh,
} from "./client";
import { toolSchemas, runTool } from "./tools";
import { runOpenAiTurn } from "./run-openai";
import { MAX_ITERATIONS, SYSTEM_PROMPT, initialLabel, type AgentEvent } from "./shared";

export type { AgentEvent };

/** Turn an SDK error into a message the user can act on (esp. 429/capacity). */
function friendlyError(e: unknown, model: string): string {
  if (e instanceof Anthropic.RateLimitError) {
    const oauth = activeKeyIsOAuth()
      ? " You're signed in with a Claude subscription — its usage limit is shared across Claude Code and this dashboard and resets on a rolling window. Wait a few minutes, ease off other Claude Code usage, or paste a standard API key for a separate pay-as-you-go pool."
      : "";
    return `The API rate-limited "${model}" (HTTP 429): the model is at capacity or your key's limit for it is exhausted.${oauth} You can also try a different model from the dropdown (Opus 4.8 is the most available) or retry in a minute.`;
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return "The Anthropic key was rejected (HTTP 401). Replace it in the key bar above.";
  }
  if (e instanceof Anthropic.APIError) {
    return `The model call failed (HTTP ${e.status ?? "?"}): ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function runAgentTurn(
  incoming: Anthropic.MessageParam[],
  sessionKey: string,
  emit: (e: AgentEvent) => void
): Promise<void> {
  // OpenAI-compatible provider runs a separate loop (different wire format).
  if (activeProvider() === "openai") {
    return runOpenAiTurn(incoming, sessionKey, emit);
  }

  await ensureAgentCredentialFresh();
  const client = getAnthropic();
  const model = agentModel();
  const fb = fallbackConfig(model);
  // A per-request `betas` header shadows the client's default oauth header, so
  // re-add oauth here when the fallback (beta) path runs with an OAuth token.
  const betas =
    fb && activeKeyIsOAuth() ? [...fb.betas, "oauth-2025-04-20"] : fb?.betas;
  const messages: Anthropic.MessageParam[] = [...incoming];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let msg: Anthropic.Message;
    try {
      // effort:"high" balances quality and latency for an interactive copilot.
      // Fable 5 also gets a server-side fallback to Opus 4.8 on safety declines.
      const stream = fb
        ? client.beta.messages.stream({
            model,
            max_tokens: 16000,
            output_config: { effort: "high" },
            betas,
            fallbacks: fb.fallbacks,
            system: SYSTEM_PROMPT,
            tools: toolSchemas,
            messages,
          })
        : client.messages.stream({
            model,
            max_tokens: 16000,
            output_config: { effort: "high" },
            system: SYSTEM_PROMPT,
            tools: toolSchemas,
            messages,
          });

      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          emit({ type: "text", text: ev.delta.text });
        }
      }
      // BetaMessage is structurally a superset of Message for the fields we use
      // (content, stop_reason); bridge the beta/non-beta type gap.
      msg = (await stream.finalMessage()) as unknown as Anthropic.Message;
    } catch (e) {
      emit({ type: "error", error: friendlyError(e, model) });
      return;
    }
    // Preserve the assistant turn verbatim (incl. any thinking/tool_use blocks)
    // so the next request in this loop stays valid on the same model.
    messages.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason === "refusal") {
      emit({ type: "text", text: "\n\n_(The request was declined.)_" });
      return;
    }
    if (msg.stop_reason !== "tool_use") return;

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      emit({ type: "tool", id: tu.id, name: tu.name, label: initialLabel(tu.name), status: "running" });
      const outcome = await runTool(
        tu.name,
        (tu.input as Record<string, unknown>) ?? {},
        { sessionKey }
      );
      emit({
        type: "tool",
        id: tu.id,
        name: tu.name,
        label: outcome.label,
        status: outcome.isError ? "error" : "done",
        detail: outcome.isError ? outcome.content : undefined,
      });
      if (outcome.staged) emit({ type: "staged" });
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: outcome.content,
        is_error: outcome.isError,
      });
    }

    messages.push({ role: "user", content: results });
  }

  emit({ type: "error", error: "Reached the maximum number of tool steps for this turn." });
}
