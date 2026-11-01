import { NextResponse } from "next/server";

import { safeNextPath } from "@/lib/deeplink";
import { SESSION_COOKIE } from "@/lib/session";
import { shouldSecureCookie } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

// Server Components cannot delete cookies during render, so recover here.
export function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const loginUrl = new URL("/login?expired=1", requestUrl);
  if (requestUrl.searchParams.has("next")) {
    loginUrl.searchParams.set("next", safeNextPath(requestUrl.searchParams.get("next")));
  }
  const response = NextResponse.redirect(loginUrl);
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: shouldSecureCookie(request.headers.get("x-forwarded-proto"), process.env.SWITCHYARD_ASSUME_HTTPS),
    maxAge: 0,
    expires: new Date(0),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
