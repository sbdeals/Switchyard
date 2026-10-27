import { describe, expect, it } from "vitest";
import { compareEnvironments, parseEnvironment, type ComparisonService } from "./environment-compare";

function service(overrides: Partial<ComparisonService> = {}): ComparisonService {
  return {
    id: "service-a",
    name: "web",
    kind: "compose",
    image: "nginx:alpine",
    source: null,
    branch: null,
    buildType: null,
    replicas: 1,
    domainsCount: 0,
    env: "MODE=production",
    ...overrides,
  };
}

describe("parseEnvironment", () => {
  it("handles comments, quotes, equals, blank values, and CRLF", () => {
    const env = [
      "# ignored",
      " export MODE = production # comment",
      'DOUBLE="a # literal = value" # comment',
      "SINGLE=' another # literal ' # comment",
      "BACKTICK=`literal # value`",
      "EQUALS=one=two=three",
      "EMPTY=",
      'QUOTED_EMPTY=""',
      "BLANK=   # comment",
      "BARE_LINE",
      "",
    ].join("\r\n");
    expect(Object.fromEntries(parseEnvironment(env))).toEqual({
      MODE: "production",
      DOUBLE: "a # literal = value",
      SINGLE: " another # literal ",
      BACKTICK: "literal # value",
      EQUALS: "one=two=three",
      EMPTY: "",
      QUOTED_EMPTY: "",
      BLANK: "",
    });
  });

  it("preserves multiline quoted values and expands only double-quoted newline escapes", () => {
    const env = [
      'MULTILINE="first',
      '# still value',
      'last" # comment',
      'ESCAPED="first\\nsecond\\rthird"',
      "LITERAL='first\\nsecond'",
      "REFERENCE=${LITERAL}",
      'ESCAPED_QUOTE="one\\"two"',
    ].join("\n");
    expect(Object.fromEntries(parseEnvironment(env))).toEqual({
      MULTILINE: "first\n# still value\nlast",
      ESCAPED: "first\nsecond\rthird",
      LITERAL: "first\\nsecond",
      REFERENCE: "${LITERAL}",
      ESCAPED_QUOTE: 'one\\"two',
    });
  });

  it("uses the last duplicate key and treats absent input as empty", () => {
    expect([...parseEnvironment("DUP=old\nDUP=new")]).toEqual([["DUP", "new"]]);
    expect([...parseEnvironment(null)]).toEqual([]);
    expect([...parseEnvironment("")]).toEqual([]);
    expect([...parseEnvironment("__proto__=literal")]).toEqual([["__proto__", "literal"]]);
  });

  it("rejects malformed quoted values without including their contents in errors", () => {
    for (const env of ['SECRET="private-value', 'SECRET="private-value" trailing']) {
      expect(() => parseEnvironment(env)).toThrow("Invalid quoted environment variable.");
    }
  });
});

describe("compareEnvironments", () => {
  it("recognizes identical configurations despite different IDs, order, and env formatting", () => {
    const a = [service(), service({ id: "worker-a", name: "worker", env: "A=1\nB=2" })];
    const b = [
      service({ id: "worker-b", name: "worker", env: "B='2'\nA=1 # same" }),
      service({ id: "service-b", env: 'MODE="production"' }),
    ];
    const result = compareEnvironments(a, b);
    expect(result.map((row) => [row.name, row.status, row.differences])).toEqual([
      ["web", "identical", []],
      ["worker", "identical", []],
    ]);
    expect(result[0].variables).toEqual([{ key: "MODE", status: "unchanged" }]);
    expect(compareEnvironments([], [])).toEqual([]);
  });

  it("shows renamed or missing services as only in A or only in B", () => {
    const result = compareEnvironments(
      [service({ name: "old-name" })],
      [service({ name: "new-name" })],
    );
    expect(result.map((row) => [row.name, row.status])).toEqual([
      ["new-name", "only-b"],
      ["old-name", "only-a"],
    ]);
    expect(result[0].a).toBeNull();
    expect(result[0].variables).toEqual([{ key: "MODE", status: "added" }]);
    expect(result[1].b).toBeNull();
    expect(result[1].variables).toEqual([{ key: "MODE", status: "removed" }]);
  });

  it("matches names exactly and rejects duplicate names in either environment", () => {
    expect(compareEnvironments([service()], [service({ name: "Web" })])
      .map((row) => row.status)).toEqual(["only-b", "only-a"]);
    expect(() => compareEnvironments([service(), service()], []))
      .toThrow("Cannot compare environments with duplicate service names.");
    expect(() => compareEnvironments([], [service(), service()]))
      .toThrow("Cannot compare environments with duplicate service names.");
  });

  it("compares every supported metadata field, including kind changes", () => {
    const result = compareEnvironments([service()], [service({
      kind: "application",
      image: "nginx:stable",
      source: "https://example.test/repo.git",
      branch: "staging",
      buildType: "dockerfile",
      replicas: 2,
      domainsCount: 1,
    })]);
    expect(result[0].status).toBe("changed");
    expect(result[0].differences).toEqual([
      "kind", "image", "source", "branch", "buildType", "replicas", "domainsCount",
    ]);
  });

  it("reports directional variable additions, removals, and changes without values", () => {
    const result = compareEnvironments(
      [service({ env: "REMOVED=private-a\nCHANGED=private-before\nEMPTY=\nSAME=private-same" })],
      [service({ env: "ADDED=private-b\nCHANGED=private-after\nSAME=private-same" })],
    );
    expect(result[0].status).toBe("changed");
    expect(result[0].differences).toEqual([]);
    expect(result[0].variables).toEqual([
      { key: "ADDED", status: "added" },
      { key: "CHANGED", status: "changed" },
      { key: "EMPTY", status: "removed" },
      { key: "REMOVED", status: "removed" },
      { key: "SAME", status: "unchanged" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(result[0].a).not.toHaveProperty("env");
    expect(result[0].b).not.toHaveProperty("env");
  });

  it("compares replica counts per compose service", () => {
    const result = compareEnvironments(
      [service({ replicas: "api: 2\nweb: 1" })],
      [service({ replicas: "api: 1\nweb: 2" })],
    );
    expect(result[0].status).toBe("changed");
    expect(result[0].differences).toEqual(["replicas"]);
  });

  it("does not leak extra server fields or mutate input services", () => {
    const input = Object.freeze({ ...service(), password: "private-password" });
    const result = compareEnvironments([input], []);
    expect(result[0].a).not.toHaveProperty("password");
    expect(JSON.stringify(result)).not.toContain("private-password");
    expect(input.env).toBe("MODE=production");
  });
});
