import { isIP } from "node:net";

export type DomainAddressKind = "public" | "host" | "internal" | "invalid";

function isInternalIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

/** Expand an already validated IPv6 literal, including dotted IPv4 tails. */
function ipv6Words(address: string): number[] {
  const hex = address.replace(/\d+\.\d+\.\d+\.\d+$/, (ipv4) => {
    const [a, b, c, d] = ipv4.split(".").map(Number);
    return `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  });
  const [head, tail] = hex.split("::");
  const leading = head ? head.split(":").map((word) => parseInt(word, 16)) : [];
  if (tail === undefined) return leading;
  const trailing = tail ? tail.split(":").map((word) => parseInt(word, 16)) : [];
  return [...leading, ...Array<number>(8 - leading.length - trailing.length).fill(0), ...trailing];
}

/** Pure destination policy; only the exact configured host IP bypasses it. */
export function classifyDomainAddress(address: string, hostIp?: string): DomainAddressKind {
  const family = isIP(address);
  // Scoped addresses and alternate numeric spellings must never reach a socket.
  if (!family || address.includes("%")) return "invalid";
  if (address === hostIp) return "host";
  if (family === 4) return isInternalIpv4(address.split(".").map(Number)) ? "internal" : "public";

  const words = ipv6Words(address);
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const octets = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
    return isInternalIpv4(octets) ? "internal" : "public";
  }

  // Restrict IPv6 to global unicast, excluding special-use and transition ranges.
  // This also refuses compatible IPv4 and NAT64 forms that could hide internal IPs.
  const [first, second] = words;
  if (first < 0x2000 || first > 0x3fff
    || (first === 0x2001 && second < 0x0200) // IETF special-use, including Teredo and benchmarks
    || (first === 0x2001 && second === 0x0db8) // Documentation
    || first === 0x2002 // 6to4
    || first === 0x3ffe // Retired 6bone
    || (first === 0x3fff && second < 0x1000)) { // Documentation
    return "internal";
  }
  return "public";
}
