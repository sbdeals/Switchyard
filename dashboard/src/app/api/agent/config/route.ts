import { agentModel } from "@/lib/agent/client";
import {
  AGENT_MODELS,
  isLoginCredential,
  looksLikeAnthropicKey,
  maskKey,
  resolveAgentKey,
  setRuntimeKey,
  setRuntimeModel,
} from "@/lib/agent/key-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The proxy already gates these routes behind the dashboard login; this
// double-checks the session cookie actually exists before touching the key.
function assertSession(req: Request): Response | null {
  const cookie = req.headers.get("cookie") ?? "";
  if (!/(?:^|;\s*)switchyard_session=/.test(cookie)) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  return null;
}

function status() {
  const resolved = resolveAgentKey();
  return {
    configured: resolved !== null,
    source: resolved?.source ?? null,
    masked: resolved ? maskKey(resolved.key) : null,
    // True when the credential came from "Sign in with Claude" (a refreshable
    // subscription login) rather than a pasted key/token.
    loginActive: resolved !== null && isLoginCredential(),
    model: agentModel(),
    models: AGENT_MODELS,
  };
}

/** GET -> { configured, source, masked, loginActive, model, models }. Never the key itself. */
export async function GET(req: Request) {
  const denied = assertSession(req);
  if (denied) return denied;
  return Response.json(status());
}

/**
 * POST { key } -> store a pasted credential (API key or sk-ant-oat… OAuth
 * token). POST { model } -> switch the copilot's model. POST { clear: true } ->
 * drop the UI-set credential (falls back to the env var if present). All take
 * effect immediately, no restart.
 */
export async function POST(req: Request) {
  const denied = assertSession(req);
  if (denied) return denied;

  let body: { key?: unknown; model?: unknown; clear?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.clear === true) {
    setRuntimeKey(null);
    return Response.json(status());
  }

  if (typeof body.model === "string") {
    if (!AGENT_MODELS.some((m) => m.id === body.model)) {
      return Response.json({ error: "Unknown model." }, { status: 400 });
    }
    setRuntimeModel(body.model);
    return Response.json(status());
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!looksLikeAnthropicKey(key)) {
    return Response.json(
      { error: "That doesn't look like an Anthropic key (expected sk-ant-…)." },
      { status: 400 },
    );
  }
  setRuntimeKey(key);
  return Response.json(status());
}
