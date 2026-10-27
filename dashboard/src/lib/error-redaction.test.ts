import { describe, expect, it } from "vitest";
import { redactErrorMessage } from "./error-redaction";

const fallback = "Could not save settings.";

describe("redactErrorMessage", () => {
  it.each(["connect ECONNREFUSED 127.0.0.1:3000", "Invalid replicas: must be nonnegative"])(
    "preserves useful diagnostics (%s)", (message) => {
      expect(redactErrorMessage(new Error(message), fallback)).toBe(message);
      expect(redactErrorMessage(message, fallback)).toBe(message);
    },
  );

  it("scrubs every URL and webhook token in quoted backend error prose", () => {
    const message = 'ECONNREFUSED "https://user:SECRET@host/api/deploy/TOKEN"; retry=ssh://other:SECOND@host/repo, {"url":"//name:THIRD@host/api/deploy/FOURTH?retry=1"}';

    expect(redactErrorMessage(message, fallback)).toBe(
      'ECONNREFUSED "https://host/api/deploy/***"; retry=ssh://host/repo, {"url":"//host/api/deploy/***?retry=1"}',
    );
  });

  it("scrubs malformed URL userinfo and bare deploy-token paths", () => {
    expect(redactErrorMessage("Invalid https://user:bad token@host and /api/deploy/SECRET", fallback))
      .toBe("Invalid https://host and /api/deploy/***");
  });

  it("preserves scp Git syntax and noncredential URL path text", () => {
    const message = "Invalid git@host:repo.git; https://host/team/foo:bar@baz.git";
    expect(redactErrorMessage(message, fallback)).toBe(message);
  });

  it("replaces every occurrence of submitted values, longest first", () => {
    expect(redactErrorMessage("Invalid SECRET_LONG, SECRET and SECRET_LONG", fallback, ["SECRET", "SECRET_LONG"]))
      .toBe("Invalid ***, *** and ***");
  });

  it("scrubs JSON-escaped and URL-encoded passwords", () => {
    const password = 'SENTINEL\\with"quotes\nand spaces';
    const message = `Invalid password: ${JSON.stringify(password)} or ${encodeURIComponent(password)}`;

    expect(redactErrorMessage(message, fallback, [password])).toBe('Invalid password: "***" or ***');
  });

  it("scrubs passwords echoed separately from a submitted URL", () => {
    const url = "https://user:SENTINEL%40password@host/repo.git";
    expect(redactErrorMessage(`Invalid ${url}; password SENTINEL@password / SENTINEL%40password`, fallback, [url]))
      .toBe("Invalid ***; password *** / ***");
  });

  it("ignores empty secret values", () => {
    expect(redactErrorMessage("Image is required.", fallback, [undefined, null, ""]))
      .toBe("Image is required.");
  });

  it.each([
    ["Invalid /api/deploy/SENTINEL_webhook", "deploy", "Invalid /api/***/***"],
    ["Invalid https://other:SENTINEL_password@host", "https", "Invalid ***://host"],
  ])("scrubs URL structure before replacing a value that overlaps it (%s)", (message, secret, expected) => {
    expect(redactErrorMessage(message, fallback, [secret])).toBe(expected);
  });

  it("uses the fallback when a truncated backend body may contain part of a secret", () => {
    const secret = "SENTINEL_" + "x".repeat(400);
    const body = `Invalid password: ${secret}`.slice(0, 300);
    expect(redactErrorMessage(`Dokploy application.update failed (400): ${body}`, fallback, [secret]))
      .toBe(fallback);
  });

  it.each([null, undefined, {}, "", " "])("uses the fallback for unusable errors (%s)", (error) => {
    expect(redactErrorMessage(error, fallback)).toBe(fallback);
  });

  it("uses the fallback when runtime secret values cannot safely be scrubbed", () => {
    expect(redactErrorMessage("Invalid input", fallback, [{} as string])).toBe(fallback);
  });
});
