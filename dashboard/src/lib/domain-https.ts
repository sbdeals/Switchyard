/** Host syntax only: DNS and ACME reachability still need to be configured. */
export function isPublicCertificateHost(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  if (!name.includes(".") || name.length > 253) return false;
  if (/(^|\.)(localhost|local|test|internal|lan|invalid|example|home\.arpa)$/.test(name)) return false;
  const labels = name.split(".");
  // Numeric TLDs also exclude IPv4; colons/brackets exclude IPv6 below.
  return !/^\d+$/.test(labels[labels.length - 1]) &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function hasPublicLetsEncryptEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const match = /^[^\s@]+@([^\s@]+)$/.exec(email.trim());
  return !!match && isPublicCertificateHost(match[1]);
}

export function domainHttpsDefaults(host: string, configured: boolean | null) {
  if (!host.trim()) {
    return { https: false, hint: "Enter a public hostname to use Let's Encrypt HTTPS." };
  }
  if (!isPublicCertificateHost(host)) {
    return { https: false, hint: "HTTP by default: local hostnames and IP addresses cannot use public certificates." };
  }
  if (configured !== true) {
    return {
      https: false,
      hint: configured === false
        ? "HTTP by default: configure a public Let's Encrypt email in Dokploy to enable automatic certificates."
        : "HTTP by default: Let's Encrypt setup has not been verified.",
    };
  }
  return { https: true, hint: "Let's Encrypt HTTPS needs public DNS pointing here and ports 80/443 reachable." };
}

/** A checked toggle is the only opt-in to requesting a new certificate. */
export function domainTlsOptions(https: boolean): { https: boolean; certificateType: "letsencrypt" | "none" } {
  return { https: https === true, certificateType: https === true ? "letsencrypt" : "none" };
}

/** Prefer usable HTTPS, then HTTP, before a local domain with an unissuable cert. */
export function preferredPublicDomain<T extends { host: string; https: boolean; certificateType: string }>(
  domains: T[],
): T | undefined {
  return domains.find((d) => d.https && (d.certificateType === "custom" || isPublicCertificateHost(d.host))) ??
    domains.find((d) => !d.https) ?? domains[0];
}
