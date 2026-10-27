import { describe, expect, it } from "vitest";
import { classifyDomainAddress } from "./domain-status-address";

const internalIpv4 = [
  "0.0.0.0", "0.255.255.255",
  "10.0.0.0", "10.255.255.255",
  "100.64.0.0", "100.127.255.255",
  "127.0.0.0", "127.0.0.1", "127.255.255.255",
  "169.254.0.0", "169.254.169.254", "169.254.255.255",
  "172.16.0.0", "172.17.0.2", "172.31.255.255",
  "192.0.0.0", "192.0.0.255",
  "192.0.2.0", "192.0.2.255",
  "192.88.99.0", "192.88.99.255",
  "192.168.0.0", "192.168.255.255",
  "198.18.0.0", "198.19.255.255",
  "198.51.100.0", "198.51.100.255",
  "203.0.113.0", "203.0.113.255",
  "224.0.0.0", "239.255.255.255",
  "240.0.0.0", "255.255.255.255",
];

const publicIpv4 = [
  "1.0.0.0", "8.8.8.8", "9.255.255.255", "11.0.0.0",
  "100.63.255.255", "100.128.0.0", "126.255.255.255", "128.0.0.0",
  "169.253.255.255", "169.255.0.0", "172.15.255.255", "172.32.0.0",
  "192.0.1.255", "192.0.3.0", "192.88.98.255", "192.88.100.0",
  "192.167.255.255", "192.169.0.0", "198.17.255.255", "198.20.0.0",
  "198.51.99.255", "198.51.101.0", "203.0.112.255", "203.0.114.0",
  "223.255.255.255",
];

function mappedIpv4(address: string): string[] {
  const [a, b, c, d] = address.split(".").map(Number);
  const tail = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  return [`::ffff:${address}`, `::ffff:${tail}`, `0:0:0:0:0:FFFF:${tail}`];
}

describe("classifyDomainAddress", () => {
  it.each(internalIpv4)("refuses non-public IPv4 range boundaries: %s", (address) => {
    expect(classifyDomainAddress(address)).toBe("internal");
  });

  it.each(publicIpv4)("allows public IPv4 adjacent to blocked ranges: %s", (address) => {
    expect(classifyDomainAddress(address)).toBe("public");
  });

  it.each(internalIpv4.flatMap(mappedIpv4))("refuses every mapped spelling of a blocked IPv4 address: %s", (address) => {
    expect(classifyDomainAddress(address)).toBe("internal");
  });

  it.each(publicIpv4.flatMap(mappedIpv4))("allows mapped public IPv4: %s", (address) => {
    expect(classifyDomainAddress(address)).toBe("public");
  });

  it.each([
    "::", "0:0:0:0:0:0:0:0", "::1", "0:0:0:0:0:0:0:1",
    "fe80::", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "ff00::", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fec0::1", "1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "4000::",
    "2001::", "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff",
    "2001:2::", "2001:2:0:ffff:ffff:ffff:ffff:ffff",
    "2001:10::1", "2001:20::1",
    "2001:db8::", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
    "3ffe::", "3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "3fff::", "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff",
    "::127.0.0.1", "::7f00:1", "::8.8.8.8",
    "64:ff9b::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::8.8.8.8",
    "64:ff9b:1::a00:1", "::ffff:0:127.0.0.1", "100::1",
    "2002:7f00:1::", "2002:0808:0808::", "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
  ])("refuses non-public IPv6 and IPv4 transition forms: %s", (address) => {
    expect(classifyDomainAddress(address)).toBe("internal");
  });

  it.each([
    "2001:200::", "2001:4860:4860::8888", "2606:4700:4700::1111",
    "2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", "2001:db9::",
    "2003::", "3fff:1000::",
  ])("allows global IPv6 outside special ranges: %s", (address) => {
    expect(classifyDomainAddress(address)).toBe("public");
  });

  it.each([
    "", "localhost", "127.1", "2130706433", "0177.0.0.1", "0x7f000001", "256.1.1.1",
    "127.0.0.1 ", " 127.0.0.1", "127.0.0.1:80", "[::1]", "bad::host",
    "fe80::1%eth0", "fe80::1%1", "2001:4860::1%lo", "::ffff:0177.0.0.1",
  ])("rejects invalid addresses even if the configured exception is identical: %s", (address) => {
    expect(classifyDomainAddress(address)).toBe("invalid");
    expect(classifyDomainAddress(address, address)).toBe("invalid");
  });

  it.each([...internalIpv4, "::", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2002:7f00:1::", "8.8.8.8"])("allows only an exact valid configured host IP: %s", (address) => {
    expect(classifyDomainAddress(address, address)).toBe("host");
  });

  it.each([
    ["127.0.0.2", "127.0.0.1"],
    ["172.17.0.2", "172.17.0.1"],
    ["10.0.0.1", "10.0.0.0/8"],
    ["127.0.0.1", "localhost"],
    ["127.0.0.1", "127.0.0.1 "],
    ["127.0.0.1", "::ffff:127.0.0.1"],
    ["::ffff:127.0.0.1", "127.0.0.1"],
    ["::ffff:7f00:1", "::ffff:127.0.0.1"],
    ["::1", "0:0:0:0:0:0:0:1"],
    ["fc00::abcd", "FC00::ABCD"],
  ])("does not expand the configured exception from %s to %s", (address, hostIp) => {
    expect(classifyDomainAddress(address, hostIp)).toBe("internal");
  });
});
