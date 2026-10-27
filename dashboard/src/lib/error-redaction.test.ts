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

  it.each([
    ["Request failed: Bearer BEARER_SENTINEL", "Request failed: Bearer ***"],
    ["Authorization: Custom AUTH_SENTINEL\nInvalid URL", "Authorization: ***\nInvalid URL"],
    ["Authorization: Custom prefix,AUTH_SENTINEL;OTHER_SENTINEL\nInvalid URL", "Authorization: ***\nInvalid URL"],
    ['{"Authorization": "Bearer AUTH_JSON_SENTINEL"}', '{"Authorization": ***}'],
    ["Cookie: better-auth.session_token=COOKIE_SENTINEL\nInvalid URL", "Cookie: ***\nInvalid URL"],
    ["x-api-key: APIKEY_SENTINEL\nInvalid URL", "x-api-key: ***\nInvalid URL"],
    ["https://host/api?token=QUERY_SENTINEL&retry=1", "https://host/api?token=***&retry=1"],
    ["https://host/api?access_token=ACCESS_SENTINEL#status", "https://host/api?access_token=***#status"],
    ["https://host/api?token=prefix,QUERY_SENTINEL;OTHER_SENTINEL&retry=1#status", "https://host/api?token=***&retry=1#status"],
    ["SECRET=ENV_SENTINEL; Invalid URL", "SECRET=*** Invalid URL"],
    ["SECRET=prefix,ENV_SENTINEL&OTHER_SENTINEL Invalid URL", "SECRET=*** Invalid URL"],
    ['APP_SECRET="ENV_SENTINEL with spaces"; Invalid URL', "APP_SECRET=***; Invalid URL"],
    ["SECRET_KEY='ENV_SENTINEL with spaces'; Invalid URL", "SECRET_KEY=***; Invalid URL"],
  ])("scrubs structured credentials without submitted values (%s)", (message, expected) => {
    expect(redactErrorMessage(new Error(message), fallback)).toBe(expected);
    expect(redactErrorMessage(message, fallback)).toBe(expected);
  });

  it("only reads the message, scrubbing credentials without exposing stack or cause", () => {
    const error = new Error([
      "Invalid URL http://USER_SENTINEL:PASSWORD_SENTINEL@host/api?token=QUERY_SENTINEL",
      "Bearer BEARER_SENTINEL",
      "Authorization: Basic AUTH_SENTINEL",
      "SECRET=ENV_SENTINEL",
    ].join("\n"), { cause: new Error("Bearer CAUSE_SENTINEL") });
    error.stack = "Authorization: STACK_SENTINEL";

    const message = redactErrorMessage(error, fallback);
    expect(message).toBe([
      "Invalid URL http://host/api?token=***",
      "Bearer ***",
      "Authorization: ***",
      "SECRET=***",
    ].join("\n"));
    expect(message).not.toContain("SENTINEL");
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
