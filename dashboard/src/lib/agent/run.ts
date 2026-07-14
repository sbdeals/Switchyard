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
  ensureAgentCredentialFresh,
} from "./client";
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
- SAFE operations you perform directly and immediately: listing/inspecting services, deploying docker images, git repos, one-click templates and databases, saving environment variables, creating domains, starting/deploying/redeploying, reading recent logs, sampling metrics, and updating replicas/resource limits.
- To DIAGNOSE a deployment ("why is X broken / down / erroring?"), look inside it: read_recent_logs for recent output, get_metrics for CPU/memory, and exec_in_service to run commands inside the running container (inspect files/config, check processes, curl an internal endpoint, or query a database with e.g. psql). Chain these — read logs, form a hypothesis, exec to confirm it, then propose or make the fix. exec_in_service is real shell access to the container, so prefer read-only/diagnostic commands and explain what you're checking.
- DESTRUCTIVE operations are NEVER executed by you — they are STAGED for the user's explicit approval: deleting a service, stopping a service, deleting a domain, and deleting a volume/mount. When you stage one, tell the user plainly that it is queued and that they must review and Apply it in the "Apply changes" bar on the canvas. Do not claim a destructive change happened — it hasn't until they approve.
- After a safe action, confirm what you did with concrete names, ids, and URLs.
- This dashboard runs locally by default, so an app named "myapp" is typically reachable at http://myapp.localhost once it has a domain. When you create a domain for a *.localhost host, HTTPS is disabled automatically.
- Be concise and practical. If a tool errors, read the message, adjust, and try again or explain the blocker.`;

/** Prettify a tool name for the initial "running" chip label. */
function initialLabel(name: string): string {
  return name.replace(/_/g, " ");
}

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
