/**
 * The tool-use loop for the OpenAI-compatible provider — same job as run.ts's
 * Anthropic loop, but speaking OpenAI /chat/completions. Streams assistant text
 * and per-tool activity through `emit`, reusing runTool() and the staged-change
 * model unchanged. Works against any OpenAI-compatible endpoint (OpenRouter,
 * Together, Groq, Nous, …) via the base URL configured in the panel.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { agentModel, getOpenAI } from "./client";
import { openAiTools } from "./openai-tools";
import { runTool } from "./tools";
import { MAX_ITERATIONS, SYSTEM_PROMPT, initialLabel, type AgentEvent } from "./shared";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Accumulator for one streamed tool call (id/name arrive first, args in fragments). */
interface ToolAcc {
  id: string;
  name: string;
  args: string;
}

/** Turn an SDK error into a message the user can act on. */
function friendlyError(e: unknown, model: string): string {
  if (e instanceof OpenAI.APIError) {
    if (e.status === 401) return "The API key was rejected (HTTP 401). Check the key and base URL in the panel above.";
    if (e.status === 404)
      return `Model "${model}" wasn't found at this endpoint (HTTP 404). Check the model id and base URL.`;
    if (e.status === 429) return `Rate-limited (HTTP 429) on "${model}". Wait a moment, or pick a different model.`;
    return `The model call failed (HTTP ${e.status ?? "?"}): ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function runOpenAiTurn(
  incoming: Anthropic.MessageParam[],
  sessionKey: string,
  emit: (e: AgentEvent) => void
): Promise<void> {
  const model = agentModel();
  if (!model) {
    emit({
      type: "error",
      error:
        "No model set for this provider. Enter a model id in the panel (e.g. an OpenRouter model like nousresearch/hermes-4-405b or deepseek/deepseek-chat).",
    });
    return;
  }

  const client = getOpenAI();

  const messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const m of incoming) {
    const content = typeof m.content === "string" ? m.content : "";
    if (m.role === "assistant") messages.push({ role: "assistant", content });
    else messages.push({ role: "user", content });
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let text = "";
    const toolAcc: Record<number, ToolAcc> = {};
    try {
      const stream = await client.chat.completions.create({
        model,
        max_tokens: 16000,
        messages,
        tools: openAiTools,
        tool_choice: "auto",
        stream: true,
      });
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) {
          text += delta.content;
          emit({ type: "text", text: delta.content });
        }
        for (const tc of delta?.tool_calls ?? []) {
          const acc = (toolAcc[tc.index ?? 0] ??= { id: "", name: "", args: "" });
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
        }
      }
    } catch (e) {
      emit({ type: "error", error: friendlyError(e, model) });
      return;
    }

    const calls = Object.values(toolAcc).filter((c) => c.name);

    // Preserve the assistant turn (text + any tool calls) for the next request.
    const assistant: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: text || null,
    };
    if (calls.length) {
      assistant.tool_calls = calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args || "{}" },
      }));
    }
    messages.push(assistant);

    if (!calls.length) return; // model produced a final answer

    for (const c of calls) {
      emit({ type: "tool", id: c.id, name: c.name, label: initialLabel(c.name), status: "running" });
      let input: Record<string, unknown> = {};
      try {
        input = c.args ? (JSON.parse(c.args) as Record<string, unknown>) : {};
      } catch {
        /* malformed args -> empty; the tool will report the missing params */
      }
      const outcome = await runTool(c.name, input, { sessionKey });
      emit({
        type: "tool",
        id: c.id,
        name: c.name,
        label: outcome.label,
        status: outcome.isError ? "error" : "done",
        detail: outcome.isError ? outcome.content : undefined,
      });
      if (outcome.staged) emit({ type: "staged" });
      messages.push({ role: "tool", tool_call_id: c.id, content: outcome.content });
    }
  }

  emit({ type: "error", error: "Reached the maximum number of tool steps for this turn." });
}
