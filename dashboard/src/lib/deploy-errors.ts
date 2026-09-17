/**
 * Turn raw engine failures into something a user can act on. Client-safe (no
 * server imports): shared by server actions, the deploy-log viewer, and status
 * badges.
 */

/** Known failure signatures, most specific first. */
const SIGNATURES: { test: RegExp; reason: string }[] = [
  {
    test: /cannot be used with services|only networks scoped to the swarm|network sandbox join failed|overlay.*(not supported|failed)|vxlan/i,
    reason:
      "This host can't start Swarm services: overlay networking isn't available (the kernel lacks VXLAN). The image is fine — the service just can't be scheduled here. New one-click services run on the local bridge network instead, so recreate it from New service.",
  },
  {
    test: /toomanyrequests|pull rate limit/i,
    reason: "Docker Hub rate-limited the image pull. Wait a few minutes and redeploy.",
  },
  {
    test: /pull access denied|manifest unknown|manifest for .* not found|repository does not exist/i,
    reason: "The image couldn't be pulled. Check the image name and tag, and registry credentials for private images.",
  },
  {
    test: /no suitable node/i,
    reason: "No node can run this service (insufficient resources or unmet placement constraints).",
  },
  {
    test: /port is already allocated|address already in use/i,
    reason: "A published port is already in use on this host. Pick a different port and redeploy.",
  },
];

/** A plain-English explanation for a known failure, or null. */
export function explainDeployError(text: string | null | undefined): string | null {
  if (!text) return null;
  return SIGNATURES.find((s) => s.test.test(text))?.reason ?? null;
}

/** Lines that only say "it failed, see above" — never the useful one. */
const GENERIC = /error occurred.*check the logs|^❌|^error:?\s*$/i;
const FAILURE = /error|failed|fatal|unexpected|denied|cannot|not found|exit code [1-9]/i;

/** The most specific failure line in a build log (searching from the end). */
export function failureLine(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l && FAILURE.test(l) && !GENERIC.test(l)) return l;
  }
  return null;
}

/**
 * Clean an engine API error for display: `Dokploy redis.deploy failed (500):
 * {"message":"…"}` becomes the inner message, with a known-cause explanation
 * appended when one matches.
 */
export function friendlyEngineError(raw: string): string {
  let msg = raw;
  const m = raw.match(/^Dokploy \S+ failed \(\d+\):\s*([\s\S]*)$/);
  if (m) {
    msg = m[1];
    try {
      const parsed = JSON.parse(msg) as { message?: unknown };
      if (typeof parsed.message === "string") msg = parsed.message;
    } catch {
      // Truncated JSON (the request helper caps bodies) — pull the message out by hand.
      const inner = msg.match(/"message":"((?:[^"\\]|\\.)*)/);
      if (inner) msg = inner[1].replace(/\\"/g, '"');
    }
  }
  msg = msg.replace(/^Dokploy\s+/, "").trim();
  const why = explainDeployError(msg);
  return why ? `${why} (${msg})` : msg;
}
