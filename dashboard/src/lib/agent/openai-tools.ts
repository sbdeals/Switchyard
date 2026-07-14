/**
 * Translate our Anthropic-shaped tool schemas into OpenAI "function" tools so
 * the same tool surface works against any OpenAI-compatible endpoint
 * (OpenRouter, Together, Groq, Nous, …). Execution is unchanged — the loop
 * still calls runTool() from ./tools.
 */
import "server-only";
import type OpenAI from "openai";
import { toolSchemas } from "./tools";

export const openAiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = toolSchemas.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description ?? undefined,
    // Anthropic `input_schema` is a JSON Schema object — the exact shape
    // OpenAI's `parameters` field wants.
    parameters: t.input_schema as Record<string, unknown>,
  },
}));
