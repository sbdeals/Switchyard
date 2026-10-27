export type DomainErrorKind =
  | "dns-not-found"
  | "timeout"
  | "connection-refused"
  | "tls"
  | "network"
  | "invalid-host";

export interface CertificateDetails {
  issuer: string | null;
  validTo: string | null;
  hostnameMatch: boolean | null;
  selfSigned: boolean;
  authorized: boolean;
}

export interface DomainStatus {
  checkedAt: string;
  level: "ok" | "warning" | "error";
  reasons: string[];
  dns: { addresses: string[]; matchesExpected: boolean | null; error?: DomainErrorKind };
  reachability: { statusCode?: number; error?: DomainErrorKind; blockedAddress?: string };
  tls?: CertificateDetails & { daysLeft: number | null; error?: DomainErrorKind };
}

export interface DomainStatusInput {
  serviceId: string;
  serviceType: "application" | "compose";
  domainId: string;
  host: string;
  https: boolean;
  path: string | null;
  expectedIps: string[];
}

export interface DomainStatusNetwork {
  resolve(host: string, timeoutMs: number): Promise<string[]>;
  reach(host: string, https: boolean, path: string, addresses: string[], timeoutMs: number): Promise<{ statusCode: number }>;
  certificate(host: string, addresses: string[], timeoutMs: number): Promise<CertificateDetails>;
}

export class DomainAddressBlockedError extends Error {
  constructor(public readonly address: string) {
    super(`Resolves to an internal address (${address}); reachability not checked.`);
  }
}

export function isValidDomainHost(host: string): boolean {
  if (!host || host.length > 253 || host !== host.trim()) return false;
  if (host.includes(":")) {
    if (!/^[a-f\d:.]+$/i.test(host)) return false;
    try {
      return new URL(`http://[${host}]/`).hostname.startsWith("[");
    } catch {
      return false;
    }
  }
  if (/^[\d.]+$/.test(host)) {
    const parts = host.split(".");
    return parts.length === 4 && parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
  }
  return host.replace(/\.$/, "").split(".").every((label) =>
    label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label),
  );
}

export function classifyDomainError(error: unknown): DomainErrorKind {
  if (!error || typeof error !== "object") return "network";
  const detail = error as { code?: string; name?: string; cause?: unknown; errors?: unknown[] };
  const code = detail.code ?? "";
  if (code === "ENOTFOUND" || code === "ENODATA" || code === "EAI_NONAME") return "dns-not-found";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || code === "ABORT_ERR" || detail.name === "AbortError" || detail.name === "TimeoutError") return "timeout";
  if (code === "ECONNREFUSED") return "connection-refused";
  if (code.includes("CERT") || code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return "tls";
  if (detail.cause) return classifyDomainError(detail.cause);
  if (Array.isArray(detail.errors)) {
    return detail.errors.map(classifyDomainError).find((kind) => kind !== "network") ?? "network";
  }
  return "network";
}

export function certificateDaysLeft(validTo: string | null, now: number): number | null {
  if (!validTo) return null;
  const expires = Date.parse(validTo);
  return Number.isFinite(expires) ? Math.ceil((expires - now) / 86_400_000) : null;
}

export function domainStatusPill(status: Pick<DomainStatus, "dns" | "reachability" | "tls">): Pick<DomainStatus, "level" | "reasons"> {
  if (status.reachability.blockedAddress) {
    return {
      level: "warning",
      reasons: [new DomainAddressBlockedError(status.reachability.blockedAddress).message],
    };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (status.dns.error || status.dns.addresses.length === 0) errors.push(`DNS: ${status.dns.error ?? "dns-not-found"}`);
  if (status.dns.matchesExpected === false) warnings.push("DNS resolves outside the service's server IPs");
  if (status.reachability.error) errors.push(`Reachability: ${status.reachability.error}`);
  if (!status.reachability.error) {
    const code = status.reachability.statusCode;
    if (code === undefined || !Number.isInteger(code) || code < 200 || code >= 600) errors.push("HTTP response unavailable");
    else if (code >= 400) errors.push(`HTTP ${code}`);
    else if (code >= 300) warnings.push(`HTTP ${code}; redirect destination not checked`);
  }
  if (status.tls) {
    const tls = status.tls;
    if (tls.error) {
      errors.push(`TLS: ${tls.error}`);
    } else {
      if (tls.daysLeft === null) errors.push("Certificate expiry unavailable");
      else if (tls.daysLeft <= 0) errors.push("Certificate expired");
      else if (tls.daysLeft <= 14) warnings.push(`Certificate expires in ${tls.daysLeft} day${tls.daysLeft === 1 ? "" : "s"}`);
      if (tls.hostnameMatch !== true) errors.push(tls.hostnameMatch === false ? "Certificate hostname mismatch" : "Certificate hostname not verified");
      if (tls.selfSigned) warnings.push("Self-signed certificate");
      else if (!tls.authorized) errors.push("Certificate is not trusted");
    }
  }
  return { level: errors.length ? "error" : warnings.length ? "warning" : "ok", reasons: [...errors, ...warnings] };
}

const EMPTY_CERTIFICATE: CertificateDetails = {
  issuer: null,
  validTo: null,
  hostnameMatch: null,
  selfSigned: false,
  authorized: false,
};

/** Call only after verifying the service and stored domain belong to the user. */
export function createDomainStatusChecker(network: DomainStatusNetwork, now: () => number = Date.now) {
  const cache = new Map<string, { config: string; expires: number; result: DomainStatus }>();
  const inFlight = new Map<string, Promise<DomainStatus>>();
  const waiting: Array<() => void> = [];
  let active = 0;

  async function acquire() {
    if (active < 4) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release() {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  async function inspect(input: DomainStatusInput): Promise<DomainStatus> {
    const result: DomainStatus = {
      checkedAt: new Date(now()).toISOString(),
      level: "ok",
      reasons: [],
      dns: { addresses: [], matchesExpected: null },
      reachability: {},
    };
    let dnsError: DomainErrorKind | undefined;
    if (!isValidDomainHost(input.host)) dnsError = "invalid-host";
    else {
      try {
        result.dns.addresses = [...new Set(await network.resolve(input.host, 5_000))];
        if (!result.dns.addresses.length) dnsError = "dns-not-found";
      } catch (error) {
        dnsError = classifyDomainError(error);
      }
    }
    if (dnsError) {
      result.dns.error = dnsError;
      result.reachability.error = dnsError;
      if (input.https) result.tls = { ...EMPTY_CERTIFICATE, daysLeft: null, error: dnsError };
    } else {
      if (input.expectedIps.length) result.dns.matchesExpected = result.dns.addresses.every((ip) => input.expectedIps.includes(ip));
      let blockedAddress: string | undefined;
      await Promise.all([
        (async () => {
          try {
            result.reachability = await network.reach(input.host, input.https, input.path || "/", result.dns.addresses, 5_000);
          } catch (error) {
            if (error instanceof DomainAddressBlockedError) blockedAddress = error.address;
            else result.reachability.error = classifyDomainError(error);
          }
        })(),
        (async () => {
          if (!input.https) return;
          try {
            const certificate = await network.certificate(input.host, result.dns.addresses, 5_000);
            result.tls = { ...certificate, daysLeft: certificateDaysLeft(certificate.validTo, now()) };
          } catch (error) {
            if (error instanceof DomainAddressBlockedError) blockedAddress = error.address;
            else result.tls = { ...EMPTY_CERTIFICATE, daysLeft: null, error: classifyDomainError(error) };
          }
        })(),
      ]);
      if (blockedAddress) {
        result.reachability = { blockedAddress };
        delete result.tls;
      }
    }
    result.checkedAt = new Date(now()).toISOString();
    return { ...result, ...domainStatusPill(result) };
  }

  return function check(input: DomainStatusInput): Promise<DomainStatus> {
    const id = JSON.stringify([input.serviceType, input.serviceId, input.domainId]);
    const config = JSON.stringify([id, input.host, input.https, input.path, [...input.expectedIps].sort()]);
    for (const [key, entry] of cache) {
      if (entry.expires <= now()) cache.delete(key);
    }
    const cached = cache.get(id);
    if (cached?.config === config) return Promise.resolve(cached.result);
    const pending = inFlight.get(config);
    if (pending) return pending;
    const promise = (async () => {
      await acquire();
      try {
        const result = await inspect(input);
        cache.set(id, { config, result, expires: now() + 30_000 });
        return result;
      } finally {
        release();
        inFlight.delete(config);
      }
    })();
    inFlight.set(config, promise);
    return promise;
  };
}
