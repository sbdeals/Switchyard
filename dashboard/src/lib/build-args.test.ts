import { describe, expect, it } from "vitest";
import { applicationInTree, parseBuildArgs, reviewBuildArgs, secretBuildArgKeys } from "./build-args";

describe("parseBuildArgs", () => {
  it("accepts blank lines, comments, export, empty values, and CRLF", () => {
    expect(parseBuildArgs("\r\n # Comment\r\n export GREETING = hello world \r\nEMPTY=\r\n_123=ok")).toEqual({
      entries: [
        { key: "GREETING", value: "hello world" },
        { key: "EMPTY", value: "" },
        { key: "_123", value: "ok" },
      ],
      errors: [],
    });
  });

  it("preserves equals signs and dollars without interpolation", () => {
    expect(parseBuildArgs("URL=https://example.test?a=1=b\nLITERAL=$GREETING ${OTHER}").entries).toEqual([
      { key: "URL", value: "https://example.test?a=1=b" },
      { key: "LITERAL", value: "$GREETING ${OTHER}" },
    ]);
  });

  it("preserves spaces and hashes inside quotes and removes inline comments", () => {
    expect(parseBuildArgs('PLAIN=hello# comment\nDOUBLE=" hello # $WORLD=x " # comment\nSINGLE=\'hello # world\'\nBACKTICK=`hello # world`')).toEqual({
      entries: [
        { key: "PLAIN", value: "hello" },
        { key: "DOUBLE", value: " hello # $WORLD=x " },
        { key: "SINGLE", value: "hello # world" },
        { key: "BACKTICK", value: "hello # world" },
      ],
      errors: [],
    });
  });

  it("only expands escaped newlines and carriage returns in double quotes", () => {
    expect(parseBuildArgs(String.raw`DOUBLE="hello\nworld\r!"
SINGLE='hello\nworld'
PLAIN=hello\nworld
ESCAPED="hello\"world"`).entries).toEqual([
      { key: "DOUBLE", value: "hello\nworld\r!" },
      { key: "SINGLE", value: String.raw`hello\nworld` },
      { key: "PLAIN", value: String.raw`hello\nworld` },
      { key: "ESCAPED", value: String.raw`hello\"world` },
    ]);
  });

  it("accepts literal trailing backslashes before closing quotes, like dotenv", () => {
    for (const quote of ['"', "'", "`"]) {
      for (const value of ["C:\\", "C:\\\\"]) {
        expect(parseBuildArgs(`PATH=${quote}${value}${quote} # comment`)).toEqual({
          entries: [{ key: "PATH", value }],
          errors: [],
        });
      }
    }
  });

  it("uses the last assignment for duplicate keys, including object property names", () => {
    expect(parseBuildArgs("GREETING=first\n__proto__=literal\nGREETING=last\nconstructor=value")).toEqual({
      entries: [
        { key: "GREETING", value: "last" },
        { key: "__proto__", value: "literal" },
        { key: "constructor", value: "value" },
      ],
      errors: [],
    });
  });

  it.each([
    "NO_EQUALS",
    "1INVALID=sensitive-value",
    "INVALID-NAME=sensitive-value",
    "INVALID NAME=sensitive-value",
    "=sensitive-value",
    'UNCLOSED="sensitive-value',
    'TRAILING="sensitive-value" extra',
  ])("rejects invalid assignments without including their contents: %s", (line) => {
    const result = parseBuildArgs(`# comment\n${line}\nVALID=kept`);
    expect(result.entries).toEqual([{ key: "VALID", value: "kept" }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Line 2:/);
    expect(result.errors[0]).not.toContain("sensitive-value");
    expect(result.errors[0]).not.toContain(line);
  });
});

describe("secretBuildArgKeys", () => {
  it("warns on matching names case-insensitively without inspecting or exposing values", () => {
    const entries = parseBuildArgs("AUTH_TOKEN=a\nclientSecret=b\nPASSWORD=c\napi_key=d\nGREETING=TOKEN").entries;
    expect(secretBuildArgKeys(entries)).toEqual(["AUTH_TOKEN", "clientSecret", "PASSWORD", "api_key"]);
    expect(secretBuildArgKeys([])).toEqual([]);
  });
});

describe("reviewBuildArgs", () => {
  it("reports additions, changes, and removals without exposing either value", () => {
    const changes = reviewBuildArgs("TOKEN=old-sensitive\nREMOVED=removed-sensitive\nSAME=unchanged", "TOKEN=new-sensitive\nADDED=added-sensitive\nSAME=unchanged");
    expect(changes).toEqual([
      { key: "TOKEN", change: "changed" },
      { key: "ADDED", change: "added" },
      { key: "REMOVED", change: "removed" },
    ]);
    expect(JSON.stringify(changes)).not.toContain("sensitive");
  });

  it("ignores comments, formatting, ordering, and overwritten duplicate values", () => {
    expect(reviewBuildArgs("A=one\nB=two", '# comment\n B = "two"\nA=overwritten\nexport A=one')).toEqual([]);
  });

  it("distinguishes an empty value from a missing argument", () => {
    expect(reviewBuildArgs("EMPTY=", "ADDED=")).toEqual([
      { key: "ADDED", change: "added" },
      { key: "EMPTY", change: "removed" },
    ]);
  });
});

describe("applicationInTree", () => {
  it("finds applications across the user's projects and environments", () => {
    const tree = [
      { environments: [{ applications: [{ applicationId: "first" }] }] },
      { environments: [{ applications: [] }, { applications: [{ applicationId: "owned" }] }] },
    ];
    expect(applicationInTree(tree, "owned")).toBe(true);
    expect(applicationInTree(tree, "other-users-app")).toBe(false);
    expect(applicationInTree(tree, "own")).toBe(false);
  });

  it("denies empty or absent environments and applications", () => {
    expect(applicationInTree([], "app")).toBe(false);
    expect(applicationInTree([{}, { environments: null }, { environments: [{}, { applications: null }] }], "app")).toBe(false);
  });

  it("only checks application IDs, not environment or project IDs", () => {
    const tree = [{ projectId: "app", environments: [{ environmentId: "app", applications: [{ applicationId: "different" }] }] }];
    expect(applicationInTree(tree, "app")).toBe(false);
  });
});
