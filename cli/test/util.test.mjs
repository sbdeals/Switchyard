import assert from "node:assert/strict";
import test from "node:test";

import { generatePassword, isValidEmail, parseJsonLines, parsePort, sha256 } from "../dist/lib.js";

test("generatePassword: long, URL-safe, non-repeating", () => {
  const pw = generatePassword();
  assert.ok(pw.length >= 20);
  assert.match(pw, /^[A-Za-z2-9]+$/);
  assert.notEqual(generatePassword(), generatePassword());
});

test("isValidEmail", () => {
  assert.ok(isValidEmail("a@b.co"));
  assert.ok(!isValidEmail("nope"));
  assert.ok(!isValidEmail("a b@c.d"));
});

test("sha256 is deterministic", () => {
  assert.equal(sha256("x"), sha256("x"));
  assert.notEqual(sha256("x"), sha256("y"));
});

test("parsePort validates", () => {
  assert.equal(parsePort("3000"), 3000);
  assert.throws(() => parsePort("0"));
  assert.throws(() => parsePort("70000"));
  assert.throws(() => parsePort("abc"));
});

test("parseJsonLines handles docker NDJSON output", () => {
  const rows = parseJsonLines('{"Name":"a","Replicas":"1/1"}\r\n{"Name":"b","Replicas":"0/1"}\n\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].Replicas, "0/1");
});
