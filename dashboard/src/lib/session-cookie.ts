/**
 * Trust the dashboard proxy's first forwarded scheme, or the explicit TLS
 * opt-in. Plain HTTP stays usable for localhost installs. Shared by dashboard
 * session issuance and clearing; Electron issues its own loopback HTTP cookie.
 */
export function shouldSecureCookie(
  forwardedProto: string | null | undefined,
  assumeHttps: string | undefined,
): boolean {
  return /^(1|true)$/i.test((assumeHttps ?? "").trim()) ||
    (forwardedProto ?? "").split(",")[0]?.trim().toLowerCase() === "https";
}
