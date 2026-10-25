import { isAgentConfigured } from "@/lib/agent/client";
import { applyStaged } from "@/lib/agent/ops";
import { listStaged, removeStaged, takeStaged, sessionKey, type StagedChange } from "@/lib/agent/store";
import { requireActiveAgentSession } from "@/lib/agent/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicView(c: StagedChange) {
  return {
    id: c.id, kind: c.kind, description: c.description, createdAt: c.createdAt,
    ...(c.kind === "exec_in_service" ? { shell: c.params } : {}),
  };
}

/** GET -> { configured, changes: [...] } */
export async function GET(req: Request) {
  // The proxy only proves a session cookie EXISTS; verify it before reading
  // or applying anything. The queue is partitioned by the verified session.
  const auth = await requireActiveAgentSession(req);
  if ("response" in auth) return auth.response;
  const key = sessionKey(auth.session);
  return Response.json({
    configured: isAgentConfigured(),
    changes: listStaged(key).map(publicView),
  });
}

/**
 * POST { action: "apply" | "discard", ids?: string[] }
 *  - apply:   consume exactly the reviewed ids before executing; return results.
 *             Even failed attempts need a fresh staged change and approval.
 *  - discard: remove the (selected) staged changes without executing.
 */
export async function POST(req: Request) {
  const auth = await requireActiveAgentSession(req);
  if ("response" in auth) return auth.response;
  const key = sessionKey(auth.session);
  let body: { action?: string; ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Object.keys(body).some((key) => key !== "action" && key !== "ids")) {
    return Response.json({ error: "Only action and pending change ids are accepted; commands and targets cannot be overridden." }, { status: 400 });
  }
  if (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string") || new Set(body.ids).size !== body.ids.length)) {
    return Response.json({ error: "ids must be an array of unique change ids." }, { status: 400 });
  }
  const ids = body.ids as string[] | undefined;

  if (body.action === "discard") {
    const removed = removeStaged(key, ids);
    return Response.json({ discarded: removed.map((c) => c.id) });
  }

  if (body.action === "apply") {
    if (!ids?.length) {
      return Response.json({ error: "Select the pending changes you reviewed before approving." }, { status: 400 });
    }
    let target: StagedChange[];
    try {
      target = takeStaged(key, ids);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
    const revalidate = async () => {
      const current = await requireActiveAgentSession(req);
      if ("response" in current) throw new Error(current.error);
    };

    const results: { id: string; description: string; ok: boolean; error?: string; output?: string }[] = [];
    for (const change of target) {
      try {
        const output = await applyStaged(change, revalidate);
        results.push({ id: change.id, description: change.description, ok: true, ...(output ? { output } : {}) });
      } catch (e) {
        results.push({
          id: change.id,
          description: change.description,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return Response.json({ results, remaining: listStaged(key).map(publicView) });
  }

  return Response.json({ error: 'Unknown action. Use "apply" or "discard".' }, { status: 400 });
}
