import { createHash, randomBytes } from "node:crypto";

/** Stable content hash used to fingerprint the rendered container spec. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * URL-safe random password. Dokploy (better-auth) requires >= 8 chars; we
 * generate well past that so auto-provisioned admins aren't the weak link.
 */
export function generatePassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

/** Random hex string for Swarm secrets (mirrors the GUID the docs pipe in). */
export function randomSecret(): string {
  return randomBytes(24).toString("hex");
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function parsePort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`invalid port: ${value}`);
  }
  return n;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
