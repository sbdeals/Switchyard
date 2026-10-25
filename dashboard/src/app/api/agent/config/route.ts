import { agentModel } from "@/lib/agent/client";
import { agentConfigAccess } from "@/lib/agent/authorization";
import {
  AGENT_MODELS,
  isLoginCredential,
  looksLikeAnthropicKey,
  maskKey,
  normalizeBaseUrl,
  resolveAgentKey,
  resolveBaseUrl,
  resolveProvider,
  setBaseUrl,
  setProvider,
  setRuntimeKey,
  setRuntimeModel,
} from "@/lib/agent/key-store";
import { requireActiveAgentSession } from "@/lib/agent/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Suggested OpenAI-compatible endpoints + a few tool-capable models. These are
 * hints only — the UI lets the user type any base URL and model id. Model ids
 * drift over time, so treat the lists as starting points, not a guarantee.
 */
const PROVIDER_PRESETS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyHint: "sk-or-…",
    models: [
      "nousresearch/hermes-4-405b",
      "deepseek/deepseek-chat",
      "qwen/qwen3-235b-a22b",
      "meta-llama/llama-3.3-70b-instruct",
      "openai/gpt-4o-mini",
    ],
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyHint: "gsk_…",
    models: ["llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct"],
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.ai/v1",
    keyHint: "sk-…",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-latest", "kimi-k2-0711-preview"],
  },
  {
    id: "together",
    label: "Together",
    baseUrl: "https://api.together.xyz/v1",
    keyHint: "",
    models: ["deepseek-ai/DeepSeek-V3", "meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyHint: "sk-…",
    models: ["gpt-4o-mini", "gpt-4o"],
  },
  { id: "custom", label: "Custom / other", baseUrl: "", keyHint: "", models: [] },
] as const;

// The proxy only checks that a session cookie EXISTS. The agent credential
// store is process-wide (one key for every user of this dashboard), so each
// handler below verifies both the envelope and its live Dokploy session.

function status(canConfigure: boolean) {
  const resolved = resolveAgentKey();
  return {
    canConfigure,
    configured: resolved !== null,
    source: resolved?.source ?? null,
    masked: resolved ? maskKey(resolved.key) : null,
    // True when the credential came from "Sign in with Claude" (a refreshable
    // subscription login) rather than a pasted key/token.
    loginActive: resolved !== null && isLoginCredential(),
    provider: resolveProvider(),
    baseUrl: resolveBaseUrl(),
    model: agentModel(),
    models: AGENT_MODELS, // Anthropic catalog (dropdown for the anthropic provider)
    presets: PROVIDER_PRESETS, // OpenAI-compatible suggestions
  };
}

/** GET -> credential + provider status (never the key itself). */
export async function GET(req: Request) {
  const auth = await requireActiveAgentSession(req);
  if ("response" in auth) return auth.response;
  const access = agentConfigAccess(auth.role);
  return Response.json(status(access.canConfigure));
}

/**
 * Admin-only POST accepts:
 *  { provider }  -> switch "anthropic" | "openai" (clears model + credential)
 *  { baseUrl }   -> set/clear the endpoint (clears credential if changed)
 *  { model }     -> set the model (validated vs catalog for anthropic; free-text for openai)
 *  { key }       -> store a pasted key (sk-ant-… enforced only for anthropic)
 *  { clear: true } -> drop the UI-set credential
 * Fields may be combined to explicitly replace a key with its endpoint.
 * All take effect immediately, no restart. Chat usage policy is unchanged.
 */
export async function POST(req: Request) {
  const auth = await requireActiveAgentSession(req);
  if ("response" in auth) return auth.response;
  const access = agentConfigAccess(auth.role);
  if (!access.canConfigure) return Response.json({ error: access.error }, { status: 403 });

  let body: { key?: unknown; model?: unknown; provider?: unknown; baseUrl?: unknown; clear?: unknown };
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.clear === true) {
    setRuntimeKey(null);
    return Response.json(status(true));
  }

  const provider = body.provider === undefined ? resolveProvider() : body.provider;
  if (provider !== "anthropic" && provider !== "openai") {
    return Response.json({ error: "Unknown provider." }, { status: 400 });
  }

  let baseUrl: string | null | undefined;
  if (body.baseUrl !== undefined) {
    try {
      if (typeof body.baseUrl !== "string") throw new Error("Enter a valid base URL.");
      baseUrl = body.baseUrl.trim() ? normalizeBaseUrl(body.baseUrl) : null;
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  let model: string | undefined;
  if (body.model !== undefined) {
    model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) return Response.json({ error: "Model can't be empty." }, { status: 400 });
    // Anthropic model must be from the catalog; OpenAI-compatible is free-text.
    if (provider === "anthropic" && !AGENT_MODELS.some((m) => m.id === model)) {
      return Response.json({ error: "Unknown model." }, { status: 400 });
    }
  }

  let key: string | undefined;
  if (body.key !== undefined) {
    key = typeof body.key === "string" ? body.key.trim() : "";
    if (provider === "anthropic" && !looksLikeAnthropicKey(key)) {
      return Response.json(
        { error: "That doesn't look like an Anthropic key (expected sk-ant-…)." },
        { status: 400 },
      );
    } else if (key.length < 8) {
      return Response.json({ error: "Enter the provider's API key." }, { status: 400 });
    }
  }

  if (body.provider === undefined && baseUrl === undefined && model === undefined && key === undefined) {
    return Response.json({ error: "No agent settings provided." }, { status: 400 });
  }
  try {
    if (body.provider !== undefined) setProvider(provider);
    if (baseUrl !== undefined) setBaseUrl(baseUrl);
    if (model !== undefined) setRuntimeModel(model);
    if (key !== undefined) setRuntimeKey(key);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json(status(true));
}
