import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Verify the signature against the exact bytes received, before parsing JSON. */
export function verifyHookSignature(body: Uint8Array, signature: string | null, secret: string): boolean {
  if (!signature || !/^sha256=[0-9a-fA-F]{64}$/.test(signature) || !secret) return false;
  const supplied = Buffer.from(signature.slice(7), "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(supplied, expected);
}

export function matchesHookRef(ref: unknown, branch: string): boolean {
  return branch.length > 0 && ref === `refs/heads/${branch}`;
}

/** Use signed commit identity when available; generic hooks use the exact body. */
export function hookDeliveryKey(body: Uint8Array, payload: { ref?: unknown; after?: unknown }): string {
  const identity = typeof payload.ref === "string" &&
    typeof payload.after === "string" && /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(payload.after)
    ? `${payload.ref}\0${payload.after.toLowerCase()}`
    : body;
  return createHash("sha256").update(identity).digest("hex");
}
