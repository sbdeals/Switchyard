import { describe, expect, it } from "vitest";
import type { DomainStatus } from "./domain-status";
import { domainStatusRows } from "./domain-status-presentation";

function status(patch: Partial<DomainStatus> = {}): DomainStatus {
  return {
    checkedAt: "2026-10-26T12:00:00.000Z",
    level: "ok",
    reasons: [],
    dns: { addresses: ["203.0.113.1", "2001:db8::1"], matchesExpected: true },
    reachability: { statusCode: 200 },
    ...patch,
  };
}

describe("domainStatusRows", () => {
  it("retains internal DNS answers and explicitly shows that HTTP and TLS were not checked", () => {
    const result = status({
      dns: { addresses: ["127.0.0.1"], matchesExpected: false },
      reachability: { blockedAddress: "127.0.0.1" },
    });
    expect(domainStatusRows(result, true)).toEqual([
      { label: "DNS", value: "127.0.0.1 · Resolves elsewhere" },
      { label: "Reachability", value: "Not checked (internal address)" },
      { label: "TLS", value: "Not checked (internal address)" },
    ]);
    expect(domainStatusRows(result, false)).toHaveLength(2);
  });

  it("shows all resolved IPs, configured DNS and HTTP status without TLS for HTTP", () => {
    expect(domainStatusRows(status(), false)).toEqual([
      { label: "DNS", value: "203.0.113.1, 2001:db8::1 · DNS configured" },
      { label: "Reachability", value: "HTTP 200" },
    ]);
  });

  it("distinguishes DNS elsewhere from an unavailable expected IP", () => {
    expect(domainStatusRows(status({ dns: { addresses: ["203.0.113.2"], matchesExpected: false } }), false)[0].value)
      .toContain("Resolves elsewhere");
    expect(domainStatusRows(status({ dns: { addresses: ["203.0.113.2"], matchesExpected: null } }), false)[0].value)
      .toContain("Server IP unavailable for comparison");
  });

  it("shows DNS and request error kinds without claiming reachability", () => {
    expect(domainStatusRows(status({
      dns: { addresses: [], matchesExpected: null, error: "dns-not-found" },
      reachability: { error: "timeout" },
    }), false)).toEqual([
      { label: "DNS", value: "dns-not-found" },
      { label: "Reachability", value: "timeout" },
    ]);
  });

  it("shows certificate issuer, UTC expiry date, remaining days and hostname match", () => {
    expect(domainStatusRows(status({ tls: {
      issuer: "Example issuer",
      validTo: "2026-11-01T12:00:00.000Z",
      daysLeft: 6,
      hostnameMatch: true,
      selfSigned: false,
      authorized: true,
    } }), true)[2]).toEqual({
      label: "TLS",
      value: "Issuer: Example issuer · Valid to 2026-11-01 (UTC) · 6 days left · Hostname matches",
    });
  });

  it("keeps expired, self-signed and mismatched certificate details visible", () => {
    const value = domainStatusRows(status({ tls: {
      issuer: null,
      validTo: "invalid",
      daysLeft: -2,
      hostnameMatch: false,
      selfSigned: true,
      authorized: false,
      error: "tls",
    } }), true)[2].value;
    expect(value).toContain("Issuer unavailable");
    expect(value).toContain("Expiry unavailable");
    expect(value).toContain("Expired 2 days ago");
    expect(value).toContain("Hostname mismatch");
    expect(value).toContain("Self-signed");
    expect(value).toContain("tls");
  });

  it("reports unavailable results without inventing certificate or DNS details", () => {
    const rows = domainStatusRows(status({
      dns: { addresses: [], matchesExpected: null },
      reachability: {},
    }), true);
    expect(rows.map((row) => row.value)).toEqual(["No addresses found", "Not checked", "Certificate unavailable"]);
    expect(domainStatusRows(status({ tls: {
      issuer: null, validTo: null, daysLeft: null, hostnameMatch: null, selfSigned: false, authorized: false,
    } }), true)[2].value).toContain("Hostname match unavailable");
  });
});
