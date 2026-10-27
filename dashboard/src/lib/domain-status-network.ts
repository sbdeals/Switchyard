import "server-only";

import { X509Certificate } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity, connect } from "node:tls";
import {
  createDomainStatusChecker,
  DomainAddressBlockedError,
  type CertificateDetails,
  type DomainStatusNetwork,
} from "./domain-status";
import { classifyDomainAddress } from "./domain-status-address";

const timeoutError = () => Object.assign(new Error("Domain check timed out"), { code: "ETIMEDOUT" });

/** Fail closed on mixed public/internal answers; never fall back to another IP. */
function vettedAddress(addresses: string[]): string {
  if (!addresses.length) throw new Error("No resolved address");
  for (const address of addresses) {
    const kind = classifyDomainAddress(address, process.env.SWITCHYARD_HOST_IP);
    if (kind === "invalid") throw new Error("Invalid resolved address");
    if (kind === "internal") throw new DomainAddressBlockedError(address);
  }
  return addresses[0];
}

export const domainStatusNetwork: DomainStatusNetwork = {
  async resolve(host, timeoutMs) {
    if (isIP(host)) return [host];
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      resolver.cancel();
    }, timeoutMs);
    try {
      const results = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
      const addresses = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      if (addresses.length) return [...new Set(addresses)];
      if (expired) throw timeoutError();
      const failure = results.find((result) => result.status === "rejected");
      throw failure?.reason ?? Object.assign(new Error("No DNS addresses"), { code: "ENODATA" });
    } finally {
      clearTimeout(timer);
    }
  },

  async reach(host, https, path, addresses, timeoutMs) {
    const address = vettedAddress(addresses);
    const deadline = Date.now() + timeoutMs;
    const probe = (method: "HEAD" | "GET") => new Promise<{ statusCode: number }>((resolve, reject) => {
      // Connect to the checked DNS address, keeping the stored host for routing
      // and SNI. Node's HTTP client never follows redirects. No cookies or body.
      const req = (https ? httpsRequest : httpRequest)({
        hostname: address,
        port: https ? 443 : 80,
        method,
        path: path.startsWith("/") && !path.startsWith("//") ? path : "/",
        headers: { Host: isIP(host) === 6 ? `[${host}]` : host },
        servername: isIP(host) ? undefined : host,
        // Report HTTP reachability even for an untrusted certificate; the
        // separate TLS inspection reports trust and hostname errors explicitly.
        rejectUnauthorized: false,
        agent: false,
      }, (res) => {
        clearTimeout(timer);
        resolve({ statusCode: res.statusCode ?? 0 });
        res.destroy();
        req.destroy();
      });
      const timer = setTimeout(() => req.destroy(timeoutError()), Math.max(1, deadline - Date.now()));
      req.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      req.end();
    });
    const response = await probe("HEAD");
    return response.statusCode === 405 || response.statusCode === 501 ? probe("GET") : response;
  },

  certificate(host, addresses, timeoutMs) {
    return new Promise<CertificateDetails>((resolve, reject) => {
      const address = vettedAddress(addresses);
      const socket = connect({
        host: address,
        port: 443,
        servername: isIP(host) ? undefined : host,
        rejectUnauthorized: false,
      });
      const timer = setTimeout(() => socket.destroy(timeoutError()), timeoutMs);
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once("secureConnect", () => {
        clearTimeout(timer);
        try {
          const cert = socket.getPeerCertificate();
          const x509 = new X509Certificate(cert.raw);
          const validTo = new Date(cert.valid_to).toISOString();
          const issuer = cert.issuer?.O || cert.issuer?.CN || x509.issuer || null;
          resolve({
            issuer: Array.isArray(issuer) ? issuer.join(", ") : issuer,
            validTo,
            hostnameMatch: checkServerIdentity(host, cert) === undefined,
            selfSigned: x509.subject === x509.issuer && x509.verify(x509.publicKey),
            authorized: socket.authorized,
          });
        } catch (error) {
          reject(error);
        } finally {
          socket.destroy();
        }
      });
    });
  },
};

// One cache and concurrency limiter for this server process, shared by users.
// Authorization happens in the route before this function is called.
export const checkDomainStatus = createDomainStatusChecker(domainStatusNetwork);
