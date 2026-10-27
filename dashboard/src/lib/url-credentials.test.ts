import { describe, expect, it } from "vitest";
import { preserveUrlCredentials, stripUrlCredentials } from "./url-credentials";

describe("stripUrlCredentials", () => {
  it.each([
    ["https://user:token@github.com/team/repo.git", "https://github.com/team/repo.git"],
    ["http://user:token@host:8080/repo.git?branch=main#readme", "http://host:8080/repo.git?branch=main#readme"],
    ["ssh://git:token@host:22/team/repo.git", "ssh://host:22/team/repo.git"],
    ["ssh://git@host/team/repo.git", "ssh://host/team/repo.git"],
    ["https://user:p%40ss@host/repo.git", "https://host/repo.git"],
    ["git@host:team/repo.git", "git@host:team/repo.git"],
    ["git@github.com:team/repo.git", "git@github.com:team/repo.git"],
    ["https://host/team/repo.git", "https://host/team/repo.git"],
    ["https://host/team/foo:bar@baz.git", "https://host/team/foo:bar@baz.git"],
    ["ssh://host/team/foo:bar@baz.git", "ssh://host/team/foo:bar@baz.git"],
    ["https://user:token@host/team/foo:bar@baz.git", "https://host/team/foo:bar@baz.git"],
    ["https://host/path/https://foo:bar@baz.git", "https://host/path/https://foo:bar@baz.git"],
    ["team/repo", "team/repo"],
    ["not a URL", "not a URL"],
    ["", ""],
    ["https://user:token@", "https://"],
    ["https://user:token@host:invalid/repo", "https://host:invalid/repo"],
    ["https:/user:token@host/repo", "https:/host/repo"],
    ["https://user:bad token@host/repo", "https://host/repo"],
    ["user:token@host/repo", "host/repo"],
    ["user:SENTINEL token@host/repo", "host/repo"],
    [" user:SENTINEL token@host/repo", " host/repo"],
    ["host/team/foo:bar@baz.git", "host/team/foo:bar@baz.git"],
    ["//user:token@host/repo", "//host/repo"],
    ["owner/https://user:token@host/repo", "owner/https://host/repo"],
  ])("strips credentials from %s", (input, expected) => {
    expect(stripUrlCredentials(input)).toBe(expected);
  });
});

describe("preserveUrlCredentials", () => {
  it("restores stored userinfo when the submitted URL matches its redacted value", () => {
    const stored = "https://user:token@host/team/repo.git";
    expect(preserveUrlCredentials("https://host/team/repo.git", stored)).toBe(stored);
  });

  it("uses an explicitly changed source or new credentials", () => {
    expect(preserveUrlCredentials("https://host/other.git", "https://user:token@host/repo.git"))
      .toBe("https://host/other.git");
    expect(preserveUrlCredentials("https://user:new@host/repo.git", "https://user:old@host/repo.git"))
      .toBe("https://user:new@host/repo.git");
    expect(preserveUrlCredentials("https://host/repo.git", null)).toBe("https://host/repo.git");
  });
});
