import { dispatchDeployHook } from "@/lib/deploy-hook-dispatch";
import { hookDeliveryKey, matchesHookRef, verifyHookSignature } from "@/lib/deploy-hooks";
import { claimDeployHook, releaseDeployHook, resolveDeployHook } from "@/lib/deploy-hook-store";
import { parsePullRequest } from "@/lib/pr-previews";
import { handlePullRequest } from "@/lib/preview-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;
const reply = (status: number, result: string) => Response.json({ result }, {
  status, headers: { "Cache-Control": "no-store" },
});

/** Read the raw signed bytes, bounding both chunked bodies and slow senders. */
async function readBody(request: Request): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES || !request.body) return null;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) return Buffer.concat(chunks, size);
          size += value.byteLength;
          if (size > MAX_BODY_BYTES) return null;
          chunks.push(value);
        }
      })(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 5000); }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export async function POST(request: Request, context: { params: Promise<{ serviceToken: string }> }) {
  const { serviceToken } = await context.params;
  try {
    const hook = resolveDeployHook(serviceToken);
    if (!hook) return reply(404, "not found");
    const body = await readBody(request);
    if (!body) return reply(413, "payload too large or incomplete");
    if (!verifyHookSignature(body, request.headers.get("x-hub-signature-256"), hook.secret)) {
      return reply(403, "invalid signature");
    }
    const event = request.headers.get("x-github-event");
    if (event === "pull_request") {
      let pullRequest;
      try {
        pullRequest = parsePullRequest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)), hook.repoUrl);
      } catch {
        return reply(400, "invalid pull request payload");
      }
      if (!pullRequest) return reply(200, "ignored pull request action");
      const result = await handlePullRequest(hook, pullRequest, request.headers.get("x-github-delivery"));
      return reply(result.status, result.result);
    }
    if (event && event !== "push") return reply(200, "ignored event");
    let payload: { ref?: unknown; after?: unknown; deleted?: unknown };
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      if (!payload || typeof payload !== "object" || typeof payload.ref !== "string") throw new Error();
    } catch {
      return reply(400, "invalid payload");
    }
    if (payload.deleted === true || (typeof payload.after === "string" && /^0+$/.test(payload.after))) {
      return reply(200, "ignored deletion");
    }
    if (!matchesHookRef(payload.ref, hook.branch)) return reply(200, "ignored ref");
    const key = hookDeliveryKey(body, payload);
    if (!claimDeployHook(serviceToken, key)) return reply(200, "duplicate or disabled");
    try {
      if (!await dispatchDeployHook(hook)) {
        releaseDeployHook(serviceToken, key);
        return reply(200, "hook changed; delivery ignored");
      }
    } catch {
      releaseDeployHook(serviceToken, key);
      return reply(503, "deploy unavailable; re-enable the hook in service Settings and retry");
    }
    return reply(202, "deployment queued");
  } catch {
    // An anonymous sender never receives backend errors or stored credentials.
    return reply(503, "hook unavailable; check service Settings");
  }
}
