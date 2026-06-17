/** Shared generators for auto-provisioned database defaults. */

const PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A 20-char password without visually ambiguous characters. */
export function randomPassword(len = 20): string {
  let out = "";
  for (let i = 0; i < len; i++) out += PW_CHARS[Math.floor(Math.random() * PW_CHARS.length)];
  return out;
}

const SUFFIX = "abcdefghijkmnpqrstuvwxyz23456789";

/** A friendly unique-ish name like "postgres-7q2f". */
export function randomServiceName(prefix: string): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += SUFFIX[Math.floor(Math.random() * SUFFIX.length)];
  return `${prefix}-${s}`;
}
