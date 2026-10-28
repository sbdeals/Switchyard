import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { openSession, sealSession, sessionFromRequest, SESSION_MAX_AGE } from "./session";

const secret = "test-only-envelope-secret";
const now = Date.parse("2026-10-27T12:00:00Z");
const payload = { dokployCookie: "dokploy=owner", email: "owner@example.test", iat: now };

// Independent issuer mirrors the desktop envelope, including legacy bad shapes.
function envelope(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

beforeEach(() => {
  vi.stubEnv("SWITCHYARD_SESSION_SECRET", secret);
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("sealed session lifetime and compatibility", () => {
  it("opens existing desktop envelopes unchanged", () => {
    expect(openSession(envelope(payload))).toEqual(payload);
    expect(openSession(sealSession(payload))).toEqual(payload);
  });

  it("stamps newly sealed payloads that omit issued-at", () => {
    expect(openSession(sealSession({ dokployCookie: payload.dokployCookie, email: payload.email })))
      .toEqual(payload);
  });

  it("accepts just before expiry and rejects at the seven-day boundary", () => {
    const token = envelope(payload);
    expect(openSession(token, now + SESSION_MAX_AGE * 1000 - 1)).toEqual(payload);
    expect(openSession(token, now + SESSION_MAX_AGE * 1000)).toBeNull();
    expect(openSession(token, now + SESSION_MAX_AGE * 1000 + 1)).toBeNull();
  });

  it.each([undefined, null, "yesterday", 0, -1, now - SESSION_MAX_AGE * 1000, now + 300_001])(
    "rejects undated, invalid, old or future issued-at: %s", (iat) => {
      expect(openSession(envelope({ ...payload, iat }))).toBeNull();
    },
  );

  it("allows at most five minutes of desktop clock skew", () => {
    expect(openSession(envelope({ ...payload, iat: now + 300_000 }))).not.toBeNull();
  });

  it.each([null, {}, { ...payload, dokployCookie: "" }, { ...payload, dokployCookie: "   " },
    { ...payload, dokployCookie: 1 }, { ...payload, email: null }])("rejects malformed envelopes %j", (value) => {
    expect(openSession(envelope(value))).toBeNull();
  });

  it.each([undefined, "x", "garbage", "%%%"])("rejects missing or forged cookies: %s", (token) => {
    expect(openSession(token)).toBeNull();
  });

  it("rejects tampering and cookies sealed with another key", () => {
    const token = Buffer.from(envelope(payload), "base64url");
    token[28] ^= 1;
    expect(openSession(token.toString("base64url"))).toBeNull();
    const valid = envelope(payload);
    vi.stubEnv("SWITCHYARD_SESSION_SECRET", "different-test-key");
    expect(openSession(valid)).toBeNull();
  });

  it("reads only the exact session cookie from the supplied request", () => {
    const token = sealSession(payload);
    const read = (cookie: string) => sessionFromRequest(new Request("http://dashboard.test", { headers: { cookie } }));
    expect(read(`other=x; switchyard_session=${token}; unrelated=y`)).toEqual(payload);
    expect(read(`other_switchyard_session=${token}`)).toBeNull();
    expect(read("switchyard_session=%xx")).toBeNull();
  });
});
