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

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  // Unauthenticated. API routes and Server Actions get a 401 (they are called
  // programmatically); page navigations get a redirect to the login screen.
  const isApi = pathname.startsWith("/api/");
  const isServerAction = request.headers.has("next-action");
  if (isApi || isServerAction) {
    return NextResponse.json(
      { error: "Unauthorized. Sign in at /login." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next internals and static assets. API and Server
  // Action requests are intentionally covered so the gate applies to them too.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
