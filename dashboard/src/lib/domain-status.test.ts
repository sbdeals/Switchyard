import { describe, expect, it, vi } from "vitest";
import {
  certificateDaysLeft,
  classifyDomainError,
  createDomainStatusChecker,
  DomainAddressBlockedError,
  domainStatusPill,
  isValidDomainHost,
  type CertificateDetails,
  type DomainStatus,
  type DomainStatusInput,
  type DomainStatusNetwork,
} from "./domain-status";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const DAY = 86_400_000;
const certificate: CertificateDetails = {
  issuer: "Example CA",
  validTo: new Date(NOW + 90 * DAY).toISOString(),
  hostnameMatch: true,
  selfSigned: false,
  authorized: true,
};
const input: DomainStatusInput = {
  serviceId: "service-1",
  serviceType: "application",
  domainId: "domain-1",
  host: "demo.example.test",
  https: true,
  path: null,
  expectedIps: ["192.0.2.1"],
};

function network(): DomainStatusNetwork {
  return {
    resolve: vi.fn().mockResolvedValue(["192.0.2.1"]),
    reach: vi.fn().mockResolvedValue({ statusCode: 200 }),
    certificate: vi.fn().mockResolvedValue(certificate),
  };
}

function healthy(): DomainStatus {
  return {
    checkedAt: new Date(NOW).toISOString(),
    level: "ok",
    reasons: [],
    dns: { addresses: ["192.0.2.1"], matchesExpected: true },
    reachability: { statusCode: 200 },
    tls: { ...certificate, daysLeft: 90 },
  };
}

describe("isValidDomainHost", () => {
  it.each(["example.test", "localhost", "demo-1.sslip.io", "example.test.", "192.0.2.1", "::1", "2001:db8::1", "xn--bcher-kva.test"])("accepts a hostname or IP: %s", (host) => {
    expect(isValidDomainHost(host)).toBe(true);
  });

  it.each(["", " example.test", "example.test ", "https://example.test", "user@example.test", "example.test/path", "example.test:443", "example.test?x=1", "example.test#x", "example.test\\other", "example..test", "-example.test", "example-.test", "*.example.test", "[::1]:443", "bad::host", "256.0.0.1", "127.1", "0192.0.2.1", `${"a".repeat(64)}.test`, `${"a.".repeat(127)}a`])("rejects invalid host syntax: %s", (host) => {
    expect(isValidDomainHost(host)).toBe(false);
  });
});

describe("classifyDomainError", () => {
  it.each([
    ["ENOTFOUND", "dns-not-found"],
    ["ENODATA", "dns-not-found"],
    ["EAI_NONAME", "dns-not-found"],
    ["ETIMEDOUT", "timeout"],
    ["ESOCKETTIMEDOUT", "timeout"],
    ["ABORT_ERR", "timeout"],
    ["ECONNREFUSED", "connection-refused"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls"],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "tls"],
    ["ECONNRESET", "network"],
  ])("classifies %s as %s", (code, kind) => {
    expect(classifyDomainError({ code })).toBe(kind);
  });

  it("handles aborts, wrapped errors, aggregate connection failures, and unknown failures", () => {
    expect(classifyDomainError({ name: "AbortError" })).toBe("timeout");
    expect(classifyDomainError({ name: "TimeoutError" })).toBe("timeout");
    expect(classifyDomainError({ cause: { code: "ENOTFOUND" } })).toBe("dns-not-found");
    expect(classifyDomainError({ errors: [{ code: "EHOSTUNREACH" }, { code: "ECONNREFUSED" }] })).toBe("connection-refused");
    expect(classifyDomainError({ errors: [] })).toBe("network");
    expect(classifyDomainError(null)).toBe("network");
    expect(classifyDomainError("failure")).toBe("network");
  });
});

describe("certificateDaysLeft", () => {
  it("rounds partial days up while keeping expired certificates non-positive", () => {
    expect(certificateDaysLeft(new Date(NOW + 14 * DAY).toISOString(), NOW)).toBe(14);
    expect(certificateDaysLeft(new Date(NOW + 14 * DAY + 1).toISOString(), NOW)).toBe(15);
    expect(certificateDaysLeft(new Date(NOW + 1).toISOString(), NOW)).toBe(1);
    expect(certificateDaysLeft(new Date(NOW).toISOString(), NOW)).toBe(0);
    expect(certificateDaysLeft(new Date(NOW - DAY).toISOString(), NOW)).toBe(-1);
  });

  it("returns null for missing or malformed dates", () => {
    expect(certificateDaysLeft(null, NOW)).toBeNull();
    expect(certificateDaysLeft("invalid", NOW)).toBeNull();
  });
});

describe("domainStatusPill", () => {
  it("warns when internal-address policy intentionally skips reachability and TLS", () => {
    expect(domainStatusPill({
      dns: { addresses: ["127.0.0.1"], matchesExpected: false },
      reachability: { blockedAddress: "127.0.0.1" },
    })).toEqual({ level: "warning", reasons: ["Resolves to an internal address (127.0.0.1); reachability not checked."] });
  });
  it("is OK for a working domain, with or without TLS or known server IPs", () => {
    expect(domainStatusPill(healthy())).toEqual({ level: "ok", reasons: [] });
    expect(domainStatusPill({ ...healthy(), dns: { addresses: ["192.0.2.1"], matchesExpected: null }, tls: undefined }).level).toBe("ok");
  });

  it.each([1, 14])("warns when the certificate has %i days left", (daysLeft) => {
    const result = healthy();
    result.tls!.daysLeft = daysLeft;
    expect(domainStatusPill(result).level).toBe("warning");
  });

  it("keeps more than fourteen days healthy", () => {
    const result = healthy();
    result.tls!.daysLeft = 15;
    expect(domainStatusPill(result).level).toBe("ok");
  });

  it("warns for self-signed certificates even when the trust store rejects them", () => {
    const result = healthy();
    Object.assign(result.tls!, { selfSigned: true, authorized: false });
    expect(domainStatusPill(result)).toEqual({ level: "warning", reasons: ["Self-signed certificate"] });
  });

  it("warns for DNS resolving elsewhere and unverified redirect destinations", () => {
    const result = healthy();
    result.dns.matchesExpected = false;
    result.reachability.statusCode = 302;
    expect(domainStatusPill(result).level).toBe("warning");
    expect(domainStatusPill(result).reasons).toHaveLength(2);
  });

  it.each([
    { daysLeft: 0 },
    { daysLeft: -1 },
    { daysLeft: null },
    { hostnameMatch: false },
    { hostnameMatch: null },
    { authorized: false },
    { error: "timeout" as const },
  ])("errors for an invalid or unavailable certificate: %j", (change) => {
    const result = healthy();
    Object.assign(result.tls!, change);
    expect(domainStatusPill(result).level).toBe("error");
  });

  it("errors for DNS failures, unreachable domains, and HTTP failures", () => {
    expect(domainStatusPill({ ...healthy(), dns: { addresses: [], matchesExpected: null } }).level).toBe("error");
    expect(domainStatusPill({ ...healthy(), reachability: { error: "connection-refused" } }).level).toBe("error");
    expect(domainStatusPill({ ...healthy(), reachability: { statusCode: 404 } }).level).toBe("error");
    expect(domainStatusPill({ ...healthy(), reachability: { statusCode: 500 } }).level).toBe("error");
  });

  it.each([undefined, 0, 199, 600, NaN])("does not report an absent or invalid HTTP status as healthy: %s", (statusCode) => {
    expect(domainStatusPill({ ...healthy(), reachability: { statusCode } }).level).toBe("error");
  });

  it("prioritizes errors over warnings and keeps both reasons", () => {
    const result = healthy();
    Object.assign(result.tls!, { selfSigned: true, authorized: false, hostnameMatch: false });
    expect(domainStatusPill(result)).toEqual({ level: "error", reasons: ["Certificate hostname mismatch", "Self-signed certificate"] });
  });
});

describe("createDomainStatusChecker", () => {
  it.each([false, true])("keeps refused IPs visible without HTTP/TLS errors or certificates (https=%s)", async (https) => {
    const adapter = network();
    vi.mocked(adapter.resolve).mockResolvedValue(["127.0.0.1"]);
    vi.mocked(adapter.reach).mockRejectedValue(new DomainAddressBlockedError("127.0.0.1"));
    vi.mocked(adapter.certificate).mockRejectedValue(new DomainAddressBlockedError("127.0.0.1"));
    const check = createDomainStatusChecker(adapter, () => NOW);
    const result = await check({ ...input, https });
    expect(result.dns.addresses).toEqual(["127.0.0.1"]);
    expect(result.reachability).toEqual({ blockedAddress: "127.0.0.1" });
    expect(result.tls).toBeUndefined();
    expect(result.level).toBe("warning");
    expect(await check({ ...input, https })).toBe(result);
    expect(adapter.resolve).toHaveBeenCalledOnce();
  });

  it("checks DNS, HTTP and TLS with a five-second timeout and pins the resolved addresses", async () => {
    const adapter = network();
    vi.mocked(adapter.resolve).mockResolvedValue(["192.0.2.1", "192.0.2.1"]);
    const result = await createDomainStatusChecker(adapter, () => NOW)(input);
    expect(result).toEqual(healthy());
    expect(adapter.resolve).toHaveBeenCalledWith(input.host, 5_000);
    expect(adapter.reach).toHaveBeenCalledWith(input.host, true, "/", ["192.0.2.1"], 5_000);
    expect(adapter.certificate).toHaveBeenCalledWith(input.host, ["192.0.2.1"], 5_000);
  });

  it("uses the stored path and skips TLS for HTTP domains", async () => {
    const adapter = network();
    const result = await createDomainStatusChecker(adapter, () => NOW)({ ...input, https: false, path: "/health" });
    expect(result.tls).toBeUndefined();
    expect(adapter.reach).toHaveBeenCalledWith(input.host, false, "/health", ["192.0.2.1"], 5_000);
    expect(adapter.certificate).not.toHaveBeenCalled();
  });

  it("rejects malformed stored hosts before any network operation", async () => {
    const adapter = network();
    const result = await createDomainStatusChecker(adapter, () => NOW)({ ...input, host: "example.test@localhost" });
    expect(result.dns.error).toBe("invalid-host");
    expect(result.level).toBe("error");
    expect(adapter.resolve).not.toHaveBeenCalled();
    expect(adapter.reach).not.toHaveBeenCalled();
    expect(adapter.certificate).not.toHaveBeenCalled();
  });

  it.each([[], null])("does not attempt HTTP or TLS after unsuccessful DNS: %j", async (addresses) => {
    const adapter = network();
    if (addresses) vi.mocked(adapter.resolve).mockResolvedValue(addresses);
    else vi.mocked(adapter.resolve).mockRejectedValue({ code: "ENOTFOUND" });
    const result = await createDomainStatusChecker(adapter, () => NOW)(input);
    expect(result.level).toBe("error");
    expect(result.dns.error).toBe("dns-not-found");
    expect(result.reachability.error).toBe("dns-not-found");
    expect(result.tls).toMatchObject({ issuer: null, validTo: null, hostnameMatch: null, daysLeft: null, error: "dns-not-found" });
    expect(adapter.reach).not.toHaveBeenCalled();
    expect(adapter.certificate).not.toHaveBeenCalled();
  });

  it("reports independent HTTP and TLS failures without losing successful DNS", async () => {
    const adapter = network();
    vi.mocked(adapter.reach).mockRejectedValue({ code: "ECONNREFUSED" });
    vi.mocked(adapter.certificate).mockRejectedValue({ code: "ETIMEDOUT" });
    const result = await createDomainStatusChecker(adapter, () => NOW)(input);
    expect(result.dns.addresses).toEqual(["192.0.2.1"]);
    expect(result.reachability.error).toBe("connection-refused");
    expect(result.tls).toEqual({ issuer: null, validTo: null, hostnameMatch: null, selfSigned: false, authorized: false, daysLeft: null, error: "timeout" });
    expect(result.level).toBe("error");
  });

  it("warns when any DNS answer is outside known server IPs, but does not guess without server IPs", async () => {
    const adapter = network();
    vi.mocked(adapter.resolve).mockResolvedValue(["192.0.2.1", "192.0.2.2"]);
    const check = createDomainStatusChecker(adapter, () => NOW);
    expect((await check(input)).dns.matchesExpected).toBe(false);
    expect((await check(input)).level).toBe("warning");
    expect((await check({ ...input, expectedIps: [] })).dns.matchesExpected).toBeNull();
    expect((await check({ ...input, expectedIps: [] })).level).toBe("ok");
  });

  it("coalesces requests, caches for thirty seconds, and rechecks at expiry", async () => {
    let now = NOW;
    const adapter = network();
    const check = createDomainStatusChecker(adapter, () => now);
    const first = check(input);
    expect(check(input)).toBe(first);
    const result = await first;
    now += 29_999;
    expect(await check(input)).toBe(result);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await check(input)).not.toBe(result);
    expect(adapter.resolve).toHaveBeenCalledTimes(2);
  });

  it.each([
    { host: "changed.example.test" },
    { https: false },
    { path: "/health" },
    { expectedIps: ["192.0.2.2"] },
    { serviceId: "service-2" },
    { serviceType: "compose" as const },
    { domainId: "domain-2" },
  ])("does not reuse cached results after stored domain or ownership inputs change: %j", async (change) => {
    const adapter = network();
    const check = createDomainStatusChecker(adapter, () => NOW);
    await check(input);
    await check({ ...input, ...change });
    expect(adapter.resolve).toHaveBeenCalledTimes(2);
  });

  it("normalizes expected IP ordering in the cache key", async () => {
    const adapter = network();
    const check = createDomainStatusChecker(adapter, () => NOW);
    await check({ ...input, expectedIps: ["192.0.2.1", "192.0.2.2"] });
    await check({ ...input, expectedIps: ["192.0.2.2", "192.0.2.1"] });
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
  });

  it("caches failed checks as well", async () => {
    const adapter = network();
    vi.mocked(adapter.resolve).mockRejectedValue({ code: "ENOTFOUND" });
    const check = createDomainStatusChecker(adapter, () => NOW);
    await check(input);
    await check(input);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
  });

  it("runs at most four domain checks at a time and releases slots after failures", async () => {
    const adapter = network();
    const gates: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    vi.mocked(adapter.certificate).mockImplementation(() => new Promise<CertificateDetails>((resolve, reject) => {
      active += 1;
      peak = Math.max(peak, active);
      gates.push(() => {
        active -= 1;
        if (gates.length === 4) reject({ code: "ETIMEDOUT" });
        else resolve(certificate);
      });
    }));
    const check = createDomainStatusChecker(adapter, () => NOW);
    const requests = Array.from({ length: 9 }, (_, i) => check({ ...input, domainId: `domain-${i}` }));
    await vi.waitFor(() => expect(gates).toHaveLength(4));
    gates.slice(0, 4).forEach((release) => release());
    await vi.waitFor(() => expect(gates).toHaveLength(8));
    gates.slice(4, 8).forEach((release) => release());
    await vi.waitFor(() => expect(gates).toHaveLength(9));
    gates[8]();
    await Promise.all(requests);
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });
});
