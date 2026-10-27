import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  http: vi.fn(),
  https: vi.fn(),
  connect: vi.fn(),
  identity: vi.fn(),
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  cancel: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("node:http", () => ({ request: mocks.http }));
vi.mock("node:https", () => ({ request: mocks.https }));
vi.mock("node:tls", () => ({ connect: mocks.connect, checkServerIdentity: mocks.identity }));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolve4 = mocks.resolve4;
    resolve6 = mocks.resolve6;
    cancel = mocks.cancel;
  },
}));
vi.mock("node:crypto", () => ({
  X509Certificate: class {
    issuer = "CN=Local issuer";
    subject = "CN=Local issuer";
    publicKey = {};
    verify = mocks.verify;
  },
}));

import { domainStatusNetwork } from "./domain-status-network";
import { createDomainStatusChecker, DomainAddressBlockedError } from "./domain-status";

function fakeRequest(statusCode: number | null) {
  const req = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    destroy: vi.fn((error?: Error) => { if (error) req.emit("error", error); }),
  });
  const response = { statusCode, destroy: vi.fn() };
  const request = vi.fn((_options: unknown, callback: (res: typeof response) => void) => {
    req.end.mockImplementation(() => { if (statusCode !== null) queueMicrotask(() => callback(response)); });
    return req;
  });
  return { req, response, request };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SWITCHYARD_HOST_IP", "");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("domain network probes", () => {
  it.each([
    "127.0.0.1", "169.254.169.254", "172.17.0.2", "10.0.0.1", "192.168.1.1",
    "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "ff02::1", "2001:2::1",
    "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:ac11:2",
  ])("refuses %s before any HTTP, HTTPS or TLS connection", async (address) => {
    await expect(domainStatusNetwork.reach("demo.test", false, "/", [address], 5000))
      .rejects.toBeInstanceOf(DomainAddressBlockedError);
    await expect(domainStatusNetwork.reach("demo.test", true, "/", [address], 5000))
      .rejects.toMatchObject({ address });
    await expect(domainStatusNetwork.certificate("demo.test", [address], 5000))
      .rejects.toMatchObject({ address });
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.https).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([[], ["localhost"], ["127.1"], ["fe80::1%eth0"]].map((addresses) => ({ addresses })))("fails closed for invalid or absent addresses: $addresses", async ({ addresses }) => {
    await expect(domainStatusNetwork.reach("demo.test", false, "/", addresses, 5000)).rejects.toThrow(/No resolved address|Invalid resolved address/);
    await expect(domainStatusNetwork.certificate("demo.test", addresses, 5000)).rejects.toThrow(/No resolved address|Invalid resolved address/);
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([["8.8.8.8", "127.0.0.1"], ["127.0.0.1", "8.8.8.8"]])("refuses mixed public/internal answers: %j", async (...addresses) => {
    await expect(domainStatusNetwork.reach("demo.test", true, "/", addresses, 5000))
      .rejects.toMatchObject({ address: "127.0.0.1" });
    await expect(domainStatusNetwork.certificate("demo.test", addresses, 5000))
      .rejects.toMatchObject({ address: "127.0.0.1" });
    expect(mocks.https).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("allows only the exact configured host IP and keeps that destination pinned", async () => {
    vi.stubEnv("SWITCHYARD_HOST_IP", "172.17.0.1");
    const { request } = fakeRequest(200);
    mocks.https.mockImplementation(request);
    expect(await domainStatusNetwork.reach("demo.test", true, "/", ["172.17.0.1"], 5000)).toEqual({ statusCode: 200 });
    expect(request.mock.calls[0][0]).toMatchObject({ hostname: "172.17.0.1", servername: "demo.test" });
    const cert = { raw: Buffer.from("fake"), valid_to: "Nov 30 00:00:00 2026 GMT", issuer: { O: "Demo CA" } };
    const socket = Object.assign(new EventEmitter(), { getPeerCertificate: () => cert, authorized: true, destroy: vi.fn() });
    mocks.connect.mockReturnValue(socket);
    const certificate = domainStatusNetwork.certificate("demo.test", ["172.17.0.1"], 5000);
    socket.emit("secureConnect");
    await certificate;
    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ host: "172.17.0.1", servername: "demo.test" }));
    await expect(domainStatusNetwork.reach("demo.test", true, "/", ["172.17.0.2"], 5000)).rejects.toBeInstanceOf(DomainAddressBlockedError);
    await expect(domainStatusNetwork.certificate("demo.test", ["::ffff:172.17.0.1"], 5000)).rejects.toBeInstanceOf(DomainAddressBlockedError);
    expect(mocks.https).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.resolve4).not.toHaveBeenCalled();
    expect(mocks.resolve6).not.toHaveBeenCalled();
  });

  it("returns the internal-address Warning and retains DNS without status or certificate disclosure", async () => {
    mocks.resolve4.mockResolvedValue(["127.0.0.1"]);
    mocks.resolve6.mockResolvedValue([]);
    const result = await createDomainStatusChecker(domainStatusNetwork)({
      serviceType: "compose", serviceId: "service-1", domainId: "domain-1",
      host: "demo.test", https: true, path: "/", expectedIps: ["127.0.0.1"],
    });
    expect(result.level).toBe("warning");
    expect(result.reasons).toEqual(["Resolves to an internal address (127.0.0.1); reachability not checked."]);
    expect(result.dns).toEqual({ addresses: ["127.0.0.1"], matchesExpected: true });
    expect(result.reachability).toEqual({ blockedAddress: "127.0.0.1" });
    expect(result.tls).toBeUndefined();
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.https).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("combines A and AAAA records, retaining success if the other family fails", async () => {
    mocks.resolve4.mockResolvedValue(["8.8.8.8"]);
    mocks.resolve6.mockResolvedValue(["2001:db8::1"]);
    expect(await domainStatusNetwork.resolve("demo.test", 5000)).toEqual(["8.8.8.8", "2001:db8::1"]);
    mocks.resolve6.mockRejectedValue({ code: "ENODATA" });
    expect(await domainStatusNetwork.resolve("demo.test", 5000)).toEqual(["8.8.8.8"]);
    expect(await domainStatusNetwork.resolve("192.0.2.2", 5000)).toEqual(["192.0.2.2"]);
  });

  it("cancels DNS at the deadline", async () => {
    vi.useFakeTimers();
    let fail4!: (error: Error) => void;
    let fail6!: (error: Error) => void;
    mocks.resolve4.mockImplementation(() => new Promise((_, reject) => { fail4 = reject; }));
    mocks.resolve6.mockImplementation(() => new Promise((_, reject) => { fail6 = reject; }));
    mocks.cancel.mockImplementation(() => { fail4(new Error("cancelled")); fail6(new Error("cancelled")); });
    const assertion = expect(domainStatusNetwork.resolve("demo.test", 5000)).rejects.toMatchObject({ code: "ETIMEDOUT" });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it("pins the address and returns cross-host redirects without following them", async () => {
    const { request, response } = fakeRequest(302);
    mocks.http.mockImplementation(request);
    expect(await domainStatusNetwork.reach("demo.test", false, "/health", ["8.8.8.8"], 5000)).toEqual({ statusCode: 302 });
    expect(mocks.http).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toMatchObject({ hostname: "8.8.8.8", port: 80, method: "HEAD", path: "/health", headers: { Host: "demo.test" } });
    expect(response.destroy).toHaveBeenCalledOnce();
  });

  it("falls back to GET for servers rejecting HEAD, without consuming bodies", async () => {
    const head = fakeRequest(405);
    const get = fakeRequest(200);
    mocks.https.mockImplementationOnce(head.request).mockImplementationOnce(get.request);
    expect(await domainStatusNetwork.reach("demo.test", true, "//elsewhere.test", ["8.8.8.8"], 5000)).toEqual({ statusCode: 200 });
    expect(get.request.mock.calls[0][0]).toMatchObject({ method: "GET", port: 443, path: "/", servername: "demo.test", rejectUnauthorized: false });
    expect(get.response.destroy).toHaveBeenCalledOnce();
  });

  it("destroys stalled HTTP requests after five seconds", async () => {
    vi.useFakeTimers();
    const { request, req } = fakeRequest(null);
    mocks.http.mockImplementation(request);
    const assertion = expect(domainStatusNetwork.reach("demo.test", false, "/", ["8.8.8.8"], 5000)).rejects.toMatchObject({ code: "ETIMEDOUT" });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(req.destroy).toHaveBeenCalledOnce();
  });

  it("inspects an untrusted certificate and checks the original hostname", async () => {
    const cert = { raw: Buffer.from("fake"), valid_to: "Nov 30 00:00:00 2026 GMT", issuer: { O: "Demo CA" } };
    const socket = Object.assign(new EventEmitter(), { getPeerCertificate: () => cert, authorized: false, destroy: vi.fn() });
    mocks.connect.mockReturnValue(socket);
    mocks.verify.mockReturnValue(true);
    mocks.identity.mockReturnValue(new Error("hostname mismatch"));
    const result = domainStatusNetwork.certificate("demo.test", ["8.8.8.8"], 5000);
    socket.emit("secureConnect");
    expect(await result).toEqual({ issuer: "Demo CA", validTo: "2026-11-30T00:00:00.000Z", hostnameMatch: false, selfSigned: true, authorized: false });
    expect(mocks.connect).toHaveBeenCalledWith({ host: "8.8.8.8", port: 443, servername: "demo.test", rejectUnauthorized: false });
    expect(mocks.identity).toHaveBeenCalledWith("demo.test", cert);
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it("does not treat a self-issued certificate with a different signing key as self-signed", async () => {
    const cert = { raw: Buffer.from("fake"), valid_to: "Nov 30 00:00:00 2026 GMT", issuer: { O: "Demo CA" } };
    const socket = Object.assign(new EventEmitter(), { getPeerCertificate: () => cert, authorized: false, destroy: vi.fn() });
    mocks.connect.mockReturnValue(socket);
    mocks.verify.mockReturnValue(false);
    const result = domainStatusNetwork.certificate("demo.test", ["8.8.8.8"], 5000);
    socket.emit("secureConnect");
    expect(await result).toMatchObject({ selfSigned: false, authorized: false });
  });

  it("destroys stalled TLS handshakes after five seconds", async () => {
    vi.useFakeTimers();
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn((error: Error) => socket.emit("error", error)) });
    mocks.connect.mockReturnValue(socket);
    const assertion = expect(domainStatusNetwork.certificate("demo.test", ["8.8.8.8"], 5000)).rejects.toMatchObject({ code: "ETIMEDOUT" });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(socket.destroy).toHaveBeenCalledOnce();
  });
});
