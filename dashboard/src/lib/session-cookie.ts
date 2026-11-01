/**
 * Trust the dashboard proxy's first forwarded scheme, or the explicit TLS
 * opt-in. Plain HTTP stays usable for localhost installs. Kept free of Next.js
 * and server-only imports so Electron's session issuer uses the same policy.
 */
export function shouldSecureCookie(
  forwardedProto: string | null | undefined,
  assumeHttps: string | undefined,
): boolean {
  return /^(1|true)$/i.test((assumeHttps ?? "").trim()) ||
    (forwardedProto ?? "").split(",")[0]?.trim().toLowerCase() === "https";
}
