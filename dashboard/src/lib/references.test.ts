import { describe, expect, it } from "vitest";
import {
  decodeStoredEnv,
  encodeStoredEnv,
  findReferences,
  resolveTemplate,
  type RefTarget,
} from "./references";
import { imageStack, withImageEnvFile } from "./managed-compose";

const db: RefTarget = {
  name: "postgres-p3ny",
  template: "POSTGRES_USER=app\nPOSTGRES_PASSWORD=s3cret",
  builtins: {
    DATABASE_URL: "postgresql://app:s3cret@postgres-p3ny-x1:5432/app",
    SWITCHYARD_HOST: "postgres-p3ny-x1",
    POSTGRES_PORT: "5432",
  },
};
const cache: RefTarget = {
  name: "Redis",
  template: "",
  builtins: { REDIS_URL: "redis://default:pw@redis-a1:6379", REDIS_HOST: "redis-a1", REDIS_PORT: "6379" },
};
const targets = [db, cache];

describe("resolveTemplate", () => {
  it("expands built-in and own variables of other services", () => {
    const r = resolveTemplate(
      "DATABASE_URL=${{postgres-p3ny.DATABASE_URL}}\nPG_PASS=${{postgres-p3ny.POSTGRES_PASSWORD}}\nLOG=info",
      "web",
      targets
    );
    expect(r.issues).toEqual([]);
    expect(r.values).toEqual({
      DATABASE_URL: "postgresql://app:s3cret@postgres-p3ny-x1:5432/app",
      PG_PASS: "s3cret",
      LOG: "info",
    });
    expect([...r.referencing]).toEqual(["DATABASE_URL", "PG_PASS"]);
    expect([...r.services]).toEqual(["postgres-p3ny"]);
  });

  it("supports several references plus literal text in one value, and whitespace", () => {
    const r = resolveTemplate("URL=redis://${{ Redis.REDIS_HOST }}:${{Redis.REDIS_PORT}}/0", "web", targets);
    expect(r.values.URL).toBe("redis://redis-a1:6379/0");
  });

  it("matches service names case-insensitively when unambiguous", () => {
    expect(resolveTemplate("U=${{redis.REDIS_URL}}", "web", targets).values.U).toBe(
      "redis://default:pw@redis-a1:6379"
    );
  });

  it("prefers the first exact match (callers order same-environment services first)", () => {
    const local: RefTarget = { name: "db", template: "", builtins: { SWITCHYARD_HOST: "db-local" } };
    const remote: RefTarget = { name: "db", template: "", builtins: { SWITCHYARD_HOST: "db-remote" } };
    expect(resolveTemplate("H=${{db.SWITCHYARD_HOST}}", "web", [local, remote]).values.H).toBe("db-local");
  });

  it("lets a service's own variables win over built-ins", () => {
    const t: RefTarget = { name: "api", template: "SWITCHYARD_HOST=api.internal", builtins: { SWITCHYARD_HOST: "api-x" } };
    expect(resolveTemplate("H=${{api.SWITCHYARD_HOST}}", "web", [t]).values.H).toBe("api.internal");
  });

  it("chains references through other services", () => {
    const api: RefTarget = { name: "api", template: "DB=${{postgres-p3ny.DATABASE_URL}}", builtins: {} };
    const r = resolveTemplate("UPSTREAM_DB=${{api.DB}}", "worker", [...targets, api]);
    expect(r.issues).toEqual([]);
    expect(r.values.UPSTREAM_DB).toBe(db.builtins.DATABASE_URL);
  });

  it("reports a missing service", () => {
    const r = resolveTemplate("X=${{nope.DATABASE_URL}}\nY=ok", "web", targets);
    expect(r.values).toEqual({ Y: "ok" });
    expect(r.issues).toEqual([
      { key: "X", ref: "${{nope.DATABASE_URL}}", message: 'No service named "nope".' },
    ]);
  });

  it("reports a missing variable and lists what exists", () => {
    const r = resolveTemplate("X=${{Redis.NOPE}}", "web", targets);
    expect(r.values.X).toBeUndefined();
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].message).toMatch(/"Redis" has no variable NOPE \(available: REDIS_URL, REDIS_HOST, REDIS_PORT\)/);
  });

  it("reports every key that hits the same failing reference", () => {
    const r = resolveTemplate("A=${{Redis.NOPE}}\nB=${{Redis.NOPE}}", "web", targets);
    expect(r.issues.map((i) => i.key)).toEqual(["A", "B"]);
  });

  it("detects a cycle between services", () => {
    const a: RefTarget = { name: "a", template: "X=${{b.Y}}", builtins: {} };
    const b: RefTarget = { name: "b", template: "Y=${{a.X}}", builtins: {} };
    const r = resolveTemplate("X=${{b.Y}}", "a", [a, b]);
    expect(r.values.X).toBeUndefined();
    expect(r.issues[0].message).toBe("Reference cycle: a.X → b.Y → a.X.");
  });

  it("detects a self-reference cycle, but allows referencing another own variable", () => {
    expect(resolveTemplate("X=${{web.X}}", "web", []).issues[0].message).toMatch(/cycle/);
    const ok = resolveTemplate("BASE=https://x\nURL=${{web.BASE}}/api", "web", []);
    expect(ok.issues).toEqual([]);
    expect(ok.values.URL).toBe("https://x/api");
  });

  it("resolves against the in-progress template for self, not the stored one", () => {
    const stored: RefTarget = { name: "web", template: "BASE=old", builtins: { SWITCHYARD_HOST: "web-1" } };
    const r = resolveTemplate("BASE=new\nU=${{web.BASE}}@${{web.SWITCHYARD_HOST}}", "web", [stored]);
    expect(r.values.U).toBe("new@web-1");
  });

  it("passes engine-native references through untouched", () => {
    const r = resolveTemplate(
      "A=${{SELF_VAR}}\nB=${{project.SHARED}}\nC=${{environment.KEY}}\nD=${{vault.path.x}}",
      "web",
      targets
    );
    expect(r.issues).toEqual([]);
    expect(r.referencing.size).toBe(0);
    expect(r.values).toEqual({
      A: "${{SELF_VAR}}",
      B: "${{project.SHARED}}",
      C: "${{environment.KEY}}",
      D: "${{vault.path.x}}",
    });
  });

  it("treats $${{…}} as an escaped literal and leaves plain $ alone", () => {
    const r = resolveTemplate("A=$${{Redis.REDIS_URL}}\nB=pa$$word$\nC=${HOME}", "web", targets);
    expect(r.issues).toEqual([]);
    expect(r.values).toEqual({ A: "${{Redis.REDIS_URL}}", B: "pa$$word$", C: "${HOME}" });
  });

  it("rejects an invalid variable name", () => {
    const r = resolveTemplate("A=${{Redis.not-valid}}", "web", targets);
    expect(r.issues[0].message).toMatch(/isn't a valid variable name/);
  });

  it("ignores comment lines", () => {
    const r = resolveTemplate("# X=${{nope.Y}}\nA=1", "web", targets);
    expect(r.issues).toEqual([]);
  });
});

describe("stored form", () => {
  const template = "# app config\nDATABASE_URL=${{postgres-p3ny.DATABASE_URL}}\nLOG=info\nLIT=$${{x.Y}}";

  it("encodes reference lines as annotation + concrete value and round-trips", () => {
    const r = resolveTemplate(template, "web", targets);
    const stored = encodeStoredEnv(template, r);
    expect(stored).toBe(
      [
        "# app config",
        "# switchyard:ref DATABASE_URL=${{postgres-p3ny.DATABASE_URL}}",
        "DATABASE_URL=postgresql://app:s3cret@postgres-p3ny-x1:5432/app",
        "LOG=info",
        "# switchyard:ref LIT=$${{x.Y}}",
        "LIT=${{x.Y}}",
      ].join("\n")
    );
    // Only the deliberately escaped literal still looks like a reference.
    expect(findReferences(stored).map((r) => r.key)).toEqual(["LIT"]);
    expect(decodeStoredEnv(stored)).toBe(template);
  });

  it("refuses to encode unresolved references", () => {
    const bad = "X=${{nope.Y}}";
    expect(() => encodeStoredEnv(bad, resolveTemplate(bad, "web", targets))).toThrow(/unresolved/);
  });

  it("decodes plain env unchanged", () => {
    expect(decodeStoredEnv("A=1\n# note\nB=2")).toBe("A=1\n# note\nB=2");
    expect(decodeStoredEnv(null)).toBe("");
  });

  it("finds references with their keys", () => {
    expect(findReferences("A=${{db.URL}}-${{cache.HOST}}\nB=${{project.X}}")).toEqual([
      { key: "A", service: "db", variable: "URL", ref: "${{db.URL}}" },
      { key: "A", service: "cache", variable: "HOST", ref: "${{cache.HOST}}" },
    ]);
  });
});

describe("withImageEnvFile", () => {
  const legacy = imageStack({ appName: "web-x1", image: "nginx:alpine" }).replace("    env_file:\n      - .env\n", "");

  it("adds env_file to a one-click image stack that lacks it, idempotently", () => {
    expect(legacy).not.toMatch(/env_file/);
    const upgraded = withImageEnvFile(legacy);
    expect(upgraded).toBe(imageStack({ appName: "web-x1", image: "nginx:alpine" }));
    expect(withImageEnvFile(upgraded)).toBe(upgraded);
  });

  it("leaves non-managed stacks alone", () => {
    const raw = "services:\n  app:\n    image: x\n    restart: always\n";
    expect(withImageEnvFile(raw)).toBe(raw);
  });
});
