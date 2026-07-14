/**
 * The server-side tool-use loop for one assistant turn. Streams the assistant's
 * text and per-tool activity out through `emit` so the API route can forward it
 * to the browser as SSE. Destructive tools stage changes rather than executing;
 * everything else runs against Dokploy immediately.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, AGENT_MODEL } from "./client";
import { toolSchemas, runTool } from "./tools";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { type: "staged" }
  | { type: "error"; error: string }
  | { type: "done" };

const MAX_ITERATIONS = 15;

const SYSTEM_PROMPT = `You are Switchyard's deployment copilot — an assistant embedded in a Railway-style dashboard built on Dokploy. A signed-in user chats with you to configure and manage their deployments (applications, databases, and docker-compose stacks) across their Dokploy projects.

How you work:
- Use your tools to answer questions and take action. Call list_services first when you need to discover what exists (ids, names, appNames, status, domains).
- SAFE operations you perform directly and immediately: listing/inspecting services, deploying docker images, git repos, one-click templates and databases, saving environment variables, creating domains, starting/deploying/redeploying, reading recent logs, and updating replicas/resource limits.
- DESTRUCTIVE operations are NEVER executed by you — they are STAGED for the user's explicit approval: deleting a service, stopping a service, deleting a domain, and deleting a volume/mount. When you stage one, tell the user plainly that it is queued and that they must review and Apply it in the "Apply changes" bar on the canvas. Do not claim a destructive change happened — it hasn't until they approve.
- After a safe action, confirm what you did with concrete names, ids, and URLs.
- This dashboard runs locally by default, so an app named "myapp" is typically reachable at http://myapp.localhost once it has a domain. When you create a domain for a *.localhost host, HTTPS is disabled automatically.
- Be concise and practical. If a tool errors, read the message, adjust, and try again or explain the blocker.`;

/** Prettify a tool name for the initial "running" chip label. */
function initialLabel(name: string): string {
  return name.replace(/_/g, " ");
}

export async function runAgentTurn(
  incoming: Anthropic.MessageParam[],
  sessionKey: string,
  emit: (e: AgentEvent) => void
): Promise<void> {
  const client = getAnthropic();
  const messages: Anthropic.MessageParam[] = [...incoming];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = client.messages.stream({
      model: AGENT_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: toolSchemas,
      messages,
    });

    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        emit({ type: "text", text: ev.delta.text });
      }
    }

    const msg = await stream.finalMessage();
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
