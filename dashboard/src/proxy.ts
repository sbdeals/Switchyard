/**
 * Request gate for the whole dashboard.
 *
 * NOTE ON THE FILENAME: Next.js 16 deprecated `middleware.ts` and renamed the
 * convention to `proxy.ts` (verified against node_modules/next/dist/docs —
 * `03-file-conventions/proxy.md`). Same job as the old middleware: it runs
 * before every matched route, including Server Actions (which POST to the route
 * that uses them) and API/SSE routes.
 *
 * This is a COARSE gate: it only checks that a Switchyard session cookie is
 * present. The cookie is validated (decrypted + authenticated) on the actual
 * data path in src/lib/session.ts / src/lib/dokploy.ts, which redirects to
 * /login if it is forged or expired. Per the Next docs, auth is verified again
 * inside server code rather than trusting the proxy alone.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_EXPIRED_MESSAGE, signInHref } from "@/lib/action-call";

// Mirror of SESSION_COOKIE in src/lib/session.ts (kept a literal so the proxy
// bundle stays free of node:crypto).
const SESSION_COOKIE = "switchyard_session";

/**
 * Paths reachable without a session:
 *  - /login          the sign-in page AND its Server Action POST target
 *  - /api/health     the installer's liveness/deep probe (shallow + ?deep=1)
 * Next static assets are excluded by the matcher below, so the login page can
 * load its CSS/JS while unauthenticated.
 */
function isPublic(pathname: string): boolean {
  return pathname === "/login" || pathname === "/api/health";
}

export function authDecision(
  pathname: string,
  method: string,
  hasSession: boolean,
  hasActionHeader: boolean,
): "allow" | "unauthorized" | "expired-action" | "login" {
  if (isPublic(pathname) || hasSession) return "allow";
  // A Next-Action header must never bypass authentication on an API route.
  if (pathname === "/api" || pathname.startsWith("/api/")) return "unauthorized";
  if (method === "POST" && hasActionHeader) return "expired-action";
  return "login";
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const decision = authDecision(
    pathname,
    request.method,
    request.cookies.has(SESSION_COOKIE),
    request.headers.has("next-action"),
  );

  if (decision === "allow") return NextResponse.next();

  if (decision === "expired-action") {
    // Next's action client preserves a text/plain error body (with this exact
    // content type). callAction catches it and keeps the editor mounted. JSON
    // would become the generic "unexpected response" error seen in E2E-028.
    return new NextResponse(SESSION_EXPIRED_MESSAGE, {
      status: 401,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }

  if (decision === "unauthorized") {
    return NextResponse.json(
      { error: "Unauthorized. Sign in at /login." },
      { status: 401 },
    );
  }

  const loginUrl = new URL(signInHref(pathname + request.nextUrl.search), request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next internals and static assets. API and Server
  // Action requests are intentionally covered so the gate applies to them too.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
