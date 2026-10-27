import { describe, expect, it } from "vitest";
import { previewRedirect, validateBasicAuth, validateRedirect } from "./app-security";

describe("validateRedirect", () => {
  it("accepts common Traefik regexes and both permanence choices", () => {
    for (const permanent of [true, false]) {
      expect(validateRedirect("^https?://example\\.com/(.*)$", "https://example.org/${1}", permanent)).toBeNull();
    }
    expect(validateRedirect("^(?:old|legacy)/[a-z]{1,1000}$", "/new", false)).toBeNull();
  });

  it.each([
    [undefined, "/new", false], ["", "/new", false], ["   ", "/new", false],
    ["/old", undefined, false], ["/old", " ", false], ["/old", "/new", "false"],
    ["a".repeat(1025), "/new", false], ["/old", "a".repeat(2049), false],
  ])("rejects missing, oversized, or incorrectly typed values", (regex, replacement, permanent) => {
    expect(validateRedirect(regex, replacement, permanent)).toBeTypeOf("string");
  });

  it.each(["[", "(abc", "*", "a{3,2}", "a{1001}", "a{1,1001}", "[]", "[^]"])("rejects invalid regex %s", (regex) => {
    expect(validateRedirect(regex, "/new", false)).toBeTypeOf("string");
  });

  it.each(["(?=old)", "(?!old)", "(?<=old)", "(?<!old)", "(old)\\1", "\\k<name>", "\\u1234", "\\q", "[\\b]"])("rejects syntax outside the shared subset: %s", (regex) => {
    expect(validateRedirect(regex, "/new", false)).toBeTypeOf("string");
  });

  it("does not confuse escaped or bracketed regex metacharacters with syntax", () => {
    expect(validateRedirect("\\(\\?=old\\)|[()?]", "/new", false)).toBeNull();
    expect(validateRedirect("[{}0-9]{2}", "/new", false)).toBeNull();
  });
});

describe("validateBasicAuth", () => {
  it("requires a nonblank username and a nonempty password", () => {
    expect(validateBasicAuth("", "secret")).toBeTypeOf("string");
    expect(validateBasicAuth("  ", "secret")).toBeTypeOf("string");
    expect(validateBasicAuth("alice", "")).toBeTypeOf("string");
    expect(validateBasicAuth(null, "secret")).toBeTypeOf("string");
    expect(validateBasicAuth("alice", false)).toBeTypeOf("string");
  });

  it.each(["alice:bob", "alice\nbob", "alice\rbob", "alice\0bob", "alice\tbob", "alice\x7fbob"])("rejects unsafe username %j", (username) => {
    expect(validateBasicAuth(username, "secret")).toBeTypeOf("string");
  });

  it("accepts password whitespace without trimming or disclosing the password", () => {
    expect(validateBasicAuth("alice", " ")).toBeNull();
    expect(validateBasicAuth("alice", "  :$secret  ")).toBeNull();
    expect(validateBasicAuth("alice:bob", "private-value")).not.toContain("private-value");
  });
});

describe("previewRedirect", () => {
  it("previews a URL with a numbered capture", () => {
    expect(previewRedirect("^https?://example\\.com/(.*)$", "https://example.org/${1}", "http://example.com/docs"))
      .toEqual({ ok: true, matched: true, result: "https://example.org/docs" });
  });

  it("returns the original URL when nothing matches", () => {
    expect(previewRedirect("/old$", "/new", "https://example.com/docs"))
      .toEqual({ ok: true, matched: false, result: "https://example.com/docs" });
  });

  it("previews the trimmed regex and replacement that will be saved", () => {
    expect(previewRedirect("  ^http://example\\.com/(.*)$  ", " https://example.org/${1} ", "http://example.com/docs"))
      .toEqual({ ok: true, matched: true, result: "https://example.org/docs" });
  });

  it("replaces every match using Go capture expansion", () => {
    expect(previewRedirect("(old)", "${1}x-$1x-$1-$0-$$-$9", "old/old"))
      .toEqual({ ok: true, matched: true, result: "oldx--old-old-$-/oldx--old-old-$-" });
  });

  it("treats JS-only replacement tokens as literal text", () => {
    expect(previewRedirect("old", "$&-$`-$'", "old"))
      .toEqual({ ok: true, matched: true, result: "$&-$`-$'" });
  });

  it("expands unmatched captures to empty strings and preserves malformed references", () => {
    expect(previewRedirect("(a)|(b)", "${1}-${2}-${missing}-${}-$-$$1-$01", "b"))
      .toEqual({ ok: true, matched: true, result: "-b--${}-$-$1-" });
  });

  it("does not replace an empty match adjacent to the previous match", () => {
    expect(previewRedirect("a*", "x", "ab"))
      .toEqual({ ok: true, matched: true, result: "xbx" });
  });

  it.each(["(a+)+$", "(a|aa)+$", "a*a*a*a*$", "(a?){100}$"])("refuses unsafe browser preview for %s while allowing save", (regex) => {
    expect(validateRedirect(regex, "/new", false)).toBeNull();
    expect(previewRedirect(regex, "/new", "a".repeat(100) + "!")).toMatchObject({ ok: false, error: expect.stringContaining("safely") });
  });

  it("returns clear errors for invalid patterns and unsupported preview URLs", () => {
    expect(previewRedirect("[", "/new", "https://example.com")).toMatchObject({ ok: false });
    expect(previewRedirect("old", "/new", "")).toMatchObject({ ok: false, error: "Enter a URL to preview." });
    expect(previewRedirect("old", "/new", "a".repeat(513))).toMatchObject({ ok: false, error: expect.stringContaining("512") });
    expect(previewRedirect("old", "/new", "https://example.com/é")).toMatchObject({ ok: false, error: expect.stringContaining("ASCII") });
    expect(previewRedirect("old$", "/new", "old\n")).toMatchObject({ ok: false });
  });
});
