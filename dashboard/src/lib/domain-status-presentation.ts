import type { DomainStatus } from "./domain-status";

export function domainStatusRows(status: DomainStatus, https: boolean) {
  const { dns, reachability, tls } = status;
  const rows = [
    {
      label: "DNS",
      value: dns.error
        ? dns.error
        : dns.addresses.length === 0
          ? "No addresses found"
          : `${dns.addresses.join(", ")}${dns.matchesExpected === false ? " · Resolves elsewhere" : dns.matchesExpected === true ? " · DNS configured" : " · Server IP unavailable for comparison"}`,
    },
    {
      label: "Reachability",
      value: reachability.blockedAddress
        ? "Not checked (internal address)"
        : reachability.error ?? (reachability.statusCode ? `HTTP ${reachability.statusCode}` : "Not checked"),
    },
  ];

  if (https) {
    const expiry = tls?.validTo ? new Date(tls.validTo) : null;
    const validTo = expiry && !Number.isNaN(expiry.getTime())
      ? `Valid to ${expiry.toISOString().slice(0, 10)} (UTC)`
      : "Expiry unavailable";
    const daysLeft = tls?.daysLeft == null
      ? null
      : tls.daysLeft < 0
        ? `Expired ${Math.abs(tls.daysLeft)} ${tls.daysLeft === -1 ? "day" : "days"} ago`
        : `${tls.daysLeft} ${tls.daysLeft === 1 ? "day" : "days"} left`;
    const hostname = tls?.hostnameMatch == null
      ? "Hostname match unavailable"
      : tls.hostnameMatch ? "Hostname matches" : "Hostname mismatch";
    rows.push({
      label: "TLS",
      value: reachability.blockedAddress
        ? "Not checked (internal address)"
        : tls
        ? [tls.issuer ? `Issuer: ${tls.issuer}` : "Issuer unavailable", validTo, daysLeft, hostname,
          tls.selfSigned ? "Self-signed" : null, tls.error].filter(Boolean).join(" · ")
        : "Certificate unavailable",
    });
  }

  return rows;
}
