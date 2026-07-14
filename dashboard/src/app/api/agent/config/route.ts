import { AGENT_MODEL } from "@/lib/agent/client";
import {
  looksLikeAnthropicKey,
  maskKey,
  resolveAgentKey,
  setRuntimeKey,
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
    model: AGENT_MODEL,
  };
}

/** GET -> { configured, source: "ui"|"env"|null, masked, model }. Never the key itself. */
export async function GET(req: Request) {
  const denied = assertSession(req);
  if (denied) return denied;
  return Response.json(status());
}

/**
 * POST { key } -> store a pasted credential (API key or sk-ant-oat… OAuth
 * token); takes effect immediately, no restart. POST { clear: true } -> drop
 * the UI-set credential (falls back to the env var if present).
 */
export async function POST(req: Request) {
  const denied = assertSession(req);
  if (denied) return denied;

  let body: { key?: unknown; clear?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.clear === true) {
    setRuntimeKey(null);
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
