import type Anthropic from "@anthropic-ai/sdk";
import { isAgentConfigured } from "@/lib/agent/client";
import { runAgentTurn, type AgentEvent } from "@/lib/agent/run";
import { sessionKey } from "@/lib/agent/store";
import { requireActiveAgentSession } from "@/lib/agent/session";
import { SSE_HEADERS } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Coerce the client payload into Anthropic message params (user/assistant text). */
function toMessages(raw: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(raw)) return [];
  const out: Anthropic.MessageParam[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      out.push({ role, content });
    }
  }
  return out;
}

/**
 * POST /api/agent/chat  { messages: [{role, content}, ...] }
 * -> SSE stream of the assistant turn: text deltas, tool activity, staged
 *    signals, then a final `done` event.
 */
export async function POST(req: Request) {
  // Verify the backing Dokploy session before spending the shared credential.
  const auth = await requireActiveAgentSession(req);
  if ("response" in auth) return auth.response;

  if (!isAgentConfigured()) {
    return Response.json(
      { error: "No Anthropic API key configured — add one at the top of the Agent panel." },
      { status: 503 }
    );
  }

  let messages: Anthropic.MessageParam[] = [];
  try {
    const body = await req.json();
    messages = toMessages((body as { messages?: unknown }).messages);
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (messages.length === 0) {
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }

  const key = sessionKey(auth.session);
  const checkSession = async () => {
    const current = await requireActiveAgentSession(req);
    // Headers are already sent; the stream reports the error and ends. The
    // next agent request returns 401 and clears the browser's session cookie.
    if ("response" in current) throw new Error(current.error);
  };
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      try {
        await runAgentTurn(messages, key, emit, checkSession);
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        emit({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
