import { describe, expect, it } from "vitest";
import {
  buildServiceReferenceGraph,
  inferEdges,
  parseServiceReferences,
  type ReferenceService,
} from "./service-references";

function service(id: string, overrides: Partial<ReferenceService> = {}): ReferenceService {
  return {
    id,
    name: id,
    appName: id,
    projectId: "project-a",
    environmentId: "production",
    env: null,
    ...overrides,
  };
}

describe("parseServiceReferences", () => {
  it("reads multiple references, hyphenated names, whitespace and quoted values", () => {
    const env = [
      'DATABASE_URL="postgres://${{cre-db.USER}}@${{ cre-db . HOST }}:${{cre-db.PORT}}"',
      "export CACHE='${{cache.HOST}}'",
    ].join("\n");
    expect(parseServiceReferences(env)).toEqual([
      { serviceName: "cre-db", variable: "USER" },
      { serviceName: "cre-db", variable: "HOST" },
      { serviceName: "cre-db", variable: "PORT" },
      { serviceName: "cache", variable: "HOST" },
    ]);
  });

  it("ignores comments, assignment keys, plain hosts and malformed references", () => {
    const env = [
      "# COMMENT=${{comment.HOST}}",
      "  # ${{indented.HOST}}",
      "${{key.HOST}}=value",
      "HOST=cre-db:5432 # ${{comment.HOST}}",
      'QUOTED="hello" # ${{comment.HOST}}',
      "${{bare.HOST}}",
      "BAD=${db.HOST} ${{db}} ${{db.}} ${{.HOST}} ${{db.HOST} ${{db.2HOST}}",
      "EMPTY=",
    ].join("\n");
    expect(parseServiceReferences(env)).toEqual([]);
    expect(parseServiceReferences(null)).toEqual([]);
  });

  it("handles multiline quotes, escaped quotes and literal comment characters", () => {
    const env = [
      'CONFIG="first line',
      '# ${{db.HOST}} and \\"quoted\\"',
      '${{cache.PORT}}" # ${{ignored.HOST}}',
      "SECOND='${{db.PORT}}'",
    ].join("\r\n");
    expect(parseServiceReferences(env)).toEqual([
      { serviceName: "db", variable: "HOST" },
      { serviceName: "cache", variable: "PORT" },
      { serviceName: "db", variable: "PORT" },
    ]);
  });

  it("ignores unterminated quoted assignments", () => {
    expect(parseServiceReferences('VALUE="${{db.HOST}}')).toEqual([]);
  });

  it("deduplicates the same reference across values without returning their contents", () => {
    expect(parseServiceReferences("A=secret-${{db.HOST}}-${{db.HOST}}\nB=${{db.HOST}}"))
      .toEqual([{ serviceName: "db", variable: "HOST" }]);
  });

  it("reads display names with spaces or dots without consuming adjacent references", () => {
    expect(parseServiceReferences("URL=${{ my db . HOST }}:${{ db.v2.PORT }}${{next.HOST}}"))
      .toEqual([
        { serviceName: "my db", variable: "HOST" },
        { serviceName: "db.v2", variable: "PORT" },
        { serviceName: "next", variable: "HOST" },
      ]);
  });

  it("rejects empty names, braces, newlines and invalid variables", () => {
    const env = [
      "EMPTY=${{ .HOST}} ${{.HOST}}",
      "BRACE=${{my{db.HOST}} ${{my}db.HOST}}",
      'MULTILINE="${{my',
      'db.HOST}}"',
      "BAD=${{db.2HOST}} ${{db.BAD-VAR}} ${{db.}} ${{valid.HOST}}",
    ].join("\n");
    expect(parseServiceReferences(env)).toEqual([{ serviceName: "valid", variable: "HOST" }]);
  });
});

describe("buildServiceReferenceGraph", () => {
  it("directs edges from the consumer to each referenced service and groups variables", () => {
    const graph = buildServiceReferenceGraph([
      service("api", { env: "URL=${{db.HOST}}:${{db.PORT}}\nCACHE=${{cache.HOST}}\nDB=${{db.HOST}}" }),
      service("db"),
      service("cache"),
    ]);
    expect(graph).toEqual({
      edges: [
        { source: "api", target: "db", kind: "reference", variables: ["HOST", "PORT"] },
        { source: "api", target: "cache", kind: "reference", variables: ["HOST"] },
      ],
      warnings: {},
    });
  });

  it("ignores self references without warning or drawing a loop", () => {
    expect(buildServiceReferenceGraph([
      service("api", { env: "SELF=${{api.HOST}}\nOTHER=${{db.HOST}}" }),
      service("db"),
    ])).toEqual({
      edges: [{ source: "api", target: "db", kind: "reference", variables: ["HOST"] }],
      warnings: {},
    });
  });

  it("deduplicates warnings for missing targets without creating edges", () => {
    expect(buildServiceReferenceGraph([
      service("api", { env: "URL=${{missing.HOST}}:${{missing.PORT}}\nCOPY=${{missing.HOST}}" }),
    ])).toEqual({
      edges: [],
      warnings: {
        api: [
          { serviceName: "missing", variable: "HOST", reason: "missing" },
          { serviceName: "missing", variable: "PORT", reason: "missing" },
        ],
      },
    });
  });

  it.each([
    { projectId: "project-b" },
    { environmentId: "staging" },
  ])("never resolves a target from another scope: %j", (scope) => {
    const api = service("api", { env: "URL=${{db.HOST}}" });
    const outside = service("outside-db", { name: "db", ...scope });
    expect(buildServiceReferenceGraph([api, outside])).toEqual({
      edges: [],
      warnings: { api: [{ serviceName: "db", variable: "HOST", reason: "missing" }] },
    });
    expect(buildServiceReferenceGraph([api, outside, service("local-db", { name: "db" })])).toEqual({
      edges: [{ source: "api", target: "local-db", kind: "reference", variables: ["HOST"] }],
      warnings: {},
    });
  });

  it("warns about ambiguous names in the same scope instead of guessing", () => {
    expect(buildServiceReferenceGraph([
      service("api", { env: "URL=${{db.HOST}}" }),
      service("db-one", { name: "db" }),
      service("db-two", { name: "db" }),
    ])).toEqual({
      edges: [],
      warnings: { api: [{ serviceName: "db", variable: "HOST", reason: "ambiguous" }] },
    });
  });

  it("uses exact case-sensitive names for explicit references", () => {
    expect(buildServiceReferenceGraph([
      service("api", { env: "URL=${{DB.HOST}}" }),
      service("db"),
    ])).toEqual({
      edges: [],
      warnings: { api: [{ serviceName: "DB", variable: "HOST", reason: "missing" }] },
    });
  });

  it("resolves display names with spaces and dots exactly", () => {
    expect(buildServiceReferenceGraph([
      service("api", { env: "URL=${{ my database.HOST }}\nHOST=${{db.v2.HOST}}" }),
      service("db-one", { name: "my database" }),
      service("db-two", { name: "db.v2" }),
    ])).toEqual({
      edges: [
        { source: "api", target: "db-one", kind: "reference", variables: ["HOST"] },
        { source: "api", target: "db-two", kind: "reference", variables: ["HOST"] },
      ],
      warnings: {},
    });
  });

  it("returns an empty graph for no services", () => {
    expect(buildServiceReferenceGraph([])).toEqual({ edges: [], warnings: {} });
  });

  it("lets an explicit edge win over a plain connection-string mention of the same target", () => {
    expect(buildServiceReferenceGraph([
      service("api", { env: "REF=${{database.HOST}}\nURL=postgres://private-value@postgres-xyz:5432/app" }),
      service("database", { appName: "postgres-xyz" }),
    ])).toEqual({
      edges: [{ source: "api", target: "database", kind: "reference", variables: ["HOST"] }],
      warnings: {},
    });
  });

  it("merges an explicit edge, a deduplicated inferred edge and a broken-ref warning", () => {
    const graph = buildServiceReferenceGraph([
      service("api", { env: "REF=${{database.HOST}}\nCACHE=redis://cre-cache:6379\nCOPY=CRE-CACHE\nMISSING=${{absent.HOST}}" }),
      service("database"),
      service("cre-cache"),
    ]);
    expect(graph).toEqual({
      edges: [
        { source: "api", target: "database", kind: "reference", variables: ["HOST"] },
        { source: "api", target: "cre-cache", kind: "inferred" },
      ],
      warnings: { api: [{ serviceName: "absent", variable: "HOST", reason: "missing" }] },
    });
    expect(JSON.stringify(graph)).not.toContain("redis://");
  });

  it("falls back to an inferred edge after an explicit reference is removed", () => {
    expect(buildServiceReferenceGraph([
      service("api", { env: "URL=postgres://private-value@postgres-xyz:5432/app" }),
      service("database", { appName: "postgres-xyz" }),
    ])).toEqual({
      edges: [{ source: "api", target: "database", kind: "inferred" }],
      warnings: {},
    });
  });

  it("never merges explicit or inferred self edges", () => {
    expect(buildServiceReferenceGraph([
      service("cre-api", { env: "REF=${{cre-api.HOST}}\nURL=http://cre-api:80" }),
    ])).toEqual({ edges: [], warnings: {} });
  });

  it("does not infer edges from missing or out-of-scope reference tokens", () => {
    expect(buildServiceReferenceGraph([
      service("api", { env: "MISSING=${{missing-database.HOST}}\nOUTSIDE=${{remote.HOST}}" }),
      service("database"),
      service("remote", { projectId: "other-project" }),
    ])).toEqual({
      edges: [],
      warnings: {
        api: [
          { serviceName: "missing-database", variable: "HOST", reason: "missing" },
          { serviceName: "remote", variable: "HOST", reason: "missing" },
        ],
      },
    });
  });
});

describe("inferEdges", () => {
  it("keeps case-insensitive name and appName substring hints, deduplicated by pair", () => {
    expect(inferEdges([
      service("api", { env: "URL=postgres://private-value@POSTGRES-XYZ:5432/app\nNOTE=database database" }),
      service("database", { appName: "postgres-xyz" }),
    ])).toEqual([{ source: "api", target: "database" }]);
  });

  it("ignores comments, explicit tokens, short names and self mentions", () => {
    expect(inferEdges([
      service("cre-api", { env: "# URL=database\nURL=http://cre-api/db # database\nREF=${{database.HOST}}" }),
      service("database"),
      service("db"),
    ])).toEqual([]);
  });
});
