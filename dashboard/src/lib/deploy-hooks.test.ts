import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hookDeliveryKey, matchesHookRef, verifyHookSignature } from "./deploy-hooks";

const body = Buffer.from('{"ref":"refs/heads/main","note":"café"}');
const secret = "test-hook-secret";
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("deploy hook signature", () => {
  it("accepts a signature over the exact request bytes", () => {
    expect(verifyHookSignature(body, signature, secret)).toBe(true);
  });

  it("rejects changed bytes and the wrong secret", () => {
    expect(verifyHookSignature(Buffer.concat([body, Buffer.from(" ")]), signature, secret)).toBe(false);
    expect(verifyHookSignature(body, signature, "different-secret")).toBe(false);
  });

  it.each([null, "", "sha256=", "sha1=" + "a".repeat(64), "sha256=" + "g".repeat(64),
    "sha256=" + "a".repeat(63), "sha256=" + "a".repeat(65), " " + signature, signature + " "])(
    "rejects missing or malformed signature %s", (value) => {
      expect(verifyHookSignature(body, value, secret)).toBe(false);
    },
  );

  it("rejects an empty secret", () => {
    expect(verifyHookSignature(body, signature, "")).toBe(false);
  });
});

describe("tracked branch matching", () => {
  it("matches the exact branch, including slash names", () => {
    expect(matchesHookRef("refs/heads/main", "main")).toBe(true);
    expect(matchesHookRef("refs/heads/feature/header", "feature/header")).toBe(true);
  });

  it.each(["main", "refs/tags/main", "refs/heads/Main", "refs/heads/main/extra", "refs/heads/release", null, 12])(
    "rejects a different or invalid ref %s", (ref) => {
      expect(matchesHookRef(ref, "main")).toBe(false);
    },
  );

  it("does not match an unset branch", () => {
    expect(matchesHookRef("refs/heads/", "")).toBe(false);
  });
});

describe("delivery identity", () => {
  it("deduplicates the same commit and branch despite other payload changes", () => {
    const payload = { ref: "refs/heads/main", after: "a".repeat(40) };
    expect(hookDeliveryKey(body, payload)).toBe(hookDeliveryKey(Buffer.from("different metadata"), payload));
    expect(hookDeliveryKey(body, payload)).not.toBe(hookDeliveryKey(body, { ...payload, after: "b".repeat(40) }));
    expect(hookDeliveryKey(body, payload)).not.toBe(hookDeliveryKey(body, { ...payload, ref: "refs/heads/release" }));
  });

  it("normalizes SHA case and also accepts SHA-256 commits", () => {
    const payload = { ref: "refs/heads/main", after: "a".repeat(64) };
    expect(hookDeliveryKey(body, payload)).toBe(hookDeliveryKey(body, { ...payload, after: "A".repeat(64) }));
  });

  it("uses exact request bytes for generic or malformed commit payloads", () => {
    const generic = { ref: "refs/heads/main" };
    expect(hookDeliveryKey(body, generic)).toBe(hookDeliveryKey(body, { ...generic, after: "invalid" }));
    expect(hookDeliveryKey(body, generic)).not.toBe(hookDeliveryKey(Buffer.concat([body, Buffer.from(" ")]), generic));
  });
});
