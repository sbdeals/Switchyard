import { describe, expect, it } from "vitest";
import type { ComposeService, Database } from "@/lib/dokploy";
import type { RefTarget } from "@/lib/references";
import {
  applyReferenceCompletion,
  getReferenceCompletion,
  referenceOptionIndex,
  referenceSuggestions,
  validateReferenceSyntax,
  validateVariableReferenceSyntax,
  validateVariableReferences,
  type ReferenceSuggestion,
} from "@/lib/variable-references";

const web: ComposeService = {
  kind: "compose", id: "web-1", name: "web", appName: "web-abc", status: "done",
  projectId: "project-1", projectName: "Project", environmentId: "env-1", environmentName: "test",
  dockerImage: "nginx:alpine", env: null, createdAt: null, cpuLimit: null, memoryLimit: null,
  referenceKeys: { own: ["TOKEN"], builtin: ["SWITCHYARD_HOST", "SWITCHYARD_SERVICE_NAME"] },
  replicas: null, composeFile: null, composeType: "docker-compose", domains: [], deployments: [],
  managed: { kind: "image", image: "nginx:alpine" },
};
const database: Database = {
  ...web, kind: "database", id: "db-1", name: "Main DB.v2", appName: "db-abc",
  engine: "postgres", databaseName: "demo", databaseUser: "demo", databasePassword: null,
  externalPort: null, command: null,
  referenceKeys: { own: ["CUSTOM"], builtin: ["SWITCHYARD_HOST", "SWITCHYARD_SERVICE_NAME", "DATABASE_URL"] },
};

describe("referenceSuggestions", () => {
  it("offers own and built-in variable names without copying their values", () => {
    const unreadable = {
      ...database,
      get env(): never { throw new Error("Suggestions must not read env values"); },
      get databasePassword(): never { throw new Error("Suggestions must not read passwords"); },
    };
    const suggestions = referenceSuggestions([web, unreadable], web);
    expect(suggestions).toContainEqual({ label: "Main DB.v2.CUSTOM", insertText: "${{Main DB.v2.CUSTOM}}", kind: "variable", self: false });
    expect(suggestions).toContainEqual({ label: "Main DB.v2.DATABASE_URL", insertText: "${{Main DB.v2.DATABASE_URL}}", kind: "builtin", self: false });
    expect(suggestions).toContainEqual({ label: "web.SWITCHYARD_HOST", insertText: "${{web.SWITCHYARD_HOST}}", kind: "builtin", self: true });
    expect(JSON.stringify(suggestions)).not.toMatch(/secret-|db-abc|web-abc|postgresql:/);
  });

  it("only offers services from the current project and environment", () => {
    const otherProject = { ...database, id: "other-project", name: "external", projectId: "project-2" };
    const otherEnvironment = { ...database, id: "other-env", name: "preview", environmentId: "env-2" };
    const suggestions = referenceSuggestions([otherProject, otherEnvironment, database], web);
    expect(suggestions.some((s) => s.label.startsWith("external.") || s.label.startsWith("preview."))).toBe(false);
    expect(suggestions.some((s) => s.label === "Main DB.v2.DATABASE_URL")).toBe(true);
    expect(suggestions.some((s) => s.label === "web.TOKEN")).toBe(true);
  });

  it("uses current self drafts and gives own variables precedence over built-ins", () => {
    const suggestions = referenceSuggestions([web, web], web, "NEW_KEY=new\nSWITCHYARD_HOST=override\nBAD.KEY=no");
    expect(suggestions.some((s) => s.label === "web.TOKEN")).toBe(false);
    expect(suggestions).toContainEqual({ label: "web.NEW_KEY", insertText: "${{web.NEW_KEY}}", kind: "variable", self: true });
    expect(suggestions.filter((s) => s.label === "web.SWITCHYARD_HOST")).toEqual([
      { label: "web.SWITCHYARD_HOST", insertText: "${{web.SWITCHYARD_HOST}}", kind: "variable", self: true },
    ]);
    expect(suggestions.some((s) => s.label === "web.BAD.KEY")).toBe(false);
  });

  it("uses loaded and edited self keys without inspecting stored env values", () => {
    const service = { ...web, env: "HIDDEN=stored-secret" };
    const suggestions = referenceSuggestions([], service, "# comment\nURL=${{db.DATABASE_URL}}\nNEW=typed-secret");
    expect(suggestions.filter((s) => s.kind === "variable").map((s) => s.label)).toEqual(["web.URL", "web.NEW"]);
    expect(JSON.stringify(suggestions)).not.toMatch(/HIDDEN|TOKEN|stored-secret|typed-secret/);
  });

  it("reveals built-ins when a draft removes a saved override", () => {
    const service = { ...web, referenceKeys: { own: ["SWITCHYARD_HOST"], builtin: ["SWITCHYARD_HOST"] } };
    expect(referenceSuggestions([], service, "")).toEqual([
      { label: "web.SWITCHYARD_HOST", insertText: "${{web.SWITCHYARD_HOST}}", kind: "builtin", self: true },
    ]);
  });

  it("never falls back to env values when page key metadata is absent", () => {
    const service = { ...web, referenceKeys: undefined, env: "HIDDEN=stored-secret" };
    expect(referenceSuggestions([], service)).toEqual([]);
  });
});

const suggestions: ReferenceSuggestion[] = [
  { label: "Main DB.v2.DATABASE_URL", insertText: "${{Main DB.v2.DATABASE_URL}}", kind: "builtin", self: false },
  { label: "cache.REDIS_URL", insertText: "${{cache.REDIS_URL}}", kind: "builtin", self: false },
  { label: "web.TOKEN", insertText: "${{web.TOKEN}}", kind: "variable", self: true },
];

describe("reference completion", () => {
  it("excludes only the edited self key, keeping other self keys and the same key on another service", () => {
    const other = { ...web, id: "other", name: "other", referenceKeys: { ...web.referenceKeys!, own: ["DEMO_URL"] } };
    const candidates = referenceSuggestions([web, other], web, "DEMO_URL=original\nOTHER_KEY=other-self-value");
    const value = "http://${{";
    const completion = getReferenceCompletion(value, value.length, candidates, "DEMO_URL")!;
    expect(completion.suggestions.map((suggestion) => suggestion.label)).toEqual([
      "other.DEMO_URL", "web.OTHER_KEY", "web.SWITCHYARD_HOST", "web.SWITCHYARD_SERVICE_NAME",
      "other.SWITCHYARD_HOST", "other.SWITCHYARD_SERVICE_NAME",
    ]);
    expect(applyReferenceCompletion(value, completion, completion.suggestions[0]).value).toBe("http://${{other.DEMO_URL}}");
    expect(getReferenceCompletion("${{web.DEMO", 11, candidates, "DEMO_URL")?.suggestions).toEqual([]);
    expect(getReferenceCompletion(value, value.length, candidates, "OTHER_KEY")?.suggestions.some((suggestion) => suggestion.label === "web.DEMO_URL")).toBe(true);
  });

  it("does not suggest a cycle when the edited row is the service's only variable", () => {
    const candidates = referenceSuggestions([], web, "DEMO_URL=original");
    const value = "http://${{";
    const completion = getReferenceCompletion(value, value.length, candidates, "DEMO_URL")!;
    const selected = applyReferenceCompletion(value, completion, completion.suggestions[0]);
    expect(completion.suggestions.map((suggestion) => suggestion.label)).toEqual(["web.SWITCHYARD_HOST", "web.SWITCHYARD_SERVICE_NAME"]);
    expect(validateVariableReferences(`DEMO_URL=${selected.value}`, "web", [
      { name: "web", template: "DEMO_URL=original", builtins: { SWITCHYARD_HOST: "web-abc" } },
    ])).toEqual([]);
  });

  it("ranks other services' variables, self variables, then built-ins, with key prefix matches first in each group", () => {
    const candidates: ReferenceSuggestion[] = [
      { label: "db.MY_HOST", kind: "builtin", self: false },
      { label: "web.MY_HOST", kind: "variable", self: true },
      { label: "other.MY_HOST", kind: "variable", self: false },
      { label: "web.HOST_LOCAL", kind: "variable", self: true },
      { label: "db.HOST", kind: "builtin", self: false },
      { label: "other.HOST_URL", kind: "variable", self: false },
    ].map((suggestion) => ({ ...suggestion, insertText: `\${{${suggestion.label}}}` } as ReferenceSuggestion));
    const originalOrder = [...candidates];
    expect(getReferenceCompletion("${{hOsT", 7, candidates)?.suggestions.map((suggestion) => suggestion.label)).toEqual([
      "other.HOST_URL", "other.MY_HOST", "web.HOST_LOCAL", "web.MY_HOST", "db.HOST", "db.MY_HOST",
    ]);
    expect(candidates).toEqual(originalOrder);
  });

  it("puts service-name prefix matches before substring matches within their group", () => {
    const candidates = referenceSuggestions([
      { ...web, id: "substring", name: "my-api", referenceKeys: { own: ["URL"], builtin: ["SWITCHYARD_SERVICE_NAME"] }, appName: "" },
      { ...web, id: "prefix", name: "api", referenceKeys: { own: ["URL"], builtin: ["SWITCHYARD_SERVICE_NAME"] }, appName: "" },
    ], web);
    expect(getReferenceCompletion("${{API", 6, candidates)?.suggestions.map((suggestion) => suggestion.label)).toEqual([
      "api.URL", "my-api.URL", "api.SWITCHYARD_SERVICE_NAME", "my-api.SWITCHYARD_SERVICE_NAME",
    ]);
  });

  it("caps ranked results at eight, counts only hidden matches, and finds hidden keys when typing more", () => {
    const candidates: ReferenceSuggestion[] = Array.from({ length: 40 }, (_, index) => ({
      label: `other.KEY_${index}`, insertText: `\${{other.KEY_${index}}}`, kind: "variable", self: false,
    }));
    candidates.unshift({ label: "web.DEMO_URL", insertText: "${{web.DEMO_URL}}", kind: "variable", self: true });
    const completion = getReferenceCompletion("http://${{", 10, candidates, "DEMO_URL")!;
    expect(completion.suggestions).toEqual(candidates.slice(1, 9));
    expect(completion.hiddenCount).toBe(32);
    expect(referenceOptionIndex(7, "ArrowDown", completion.suggestions.length)).toBe(0);
    expect(referenceOptionIndex(0, "ArrowUp", completion.suggestions.length)).toBe(7);
    const query = "${{other.KEY_39";
    const narrowed = getReferenceCompletion(query, query.length, candidates, "DEMO_URL")!;
    expect(narrowed.suggestions).toEqual([candidates[40]]);
    expect(narrowed.hiddenCount).toBe(0);
    expect(getReferenceCompletion("${{missing", 10, candidates)?.hiddenCount).toBe(0);
    expect(getReferenceCompletion("${{", 3, candidates.slice(1, 9))?.hiddenCount).toBe(0);
  });

  it("opens after the full trigger and filters both service names and keys without case sensitivity", () => {
    expect(getReferenceCompletion("${{", 3, suggestions)?.suggestions).toEqual([suggestions[2], suggestions[0], suggestions[1]]);
    expect(getReferenceCompletion("${{main db.v2.da", 15, suggestions)?.suggestions).toEqual([suggestions[0]]);
    expect(getReferenceCompletion("${{redis_url", 12, suggestions)?.suggestions).toEqual([suggestions[1]]);
    expect(getReferenceCompletion("${{ unknown", 11, suggestions)?.suggestions).toEqual([]);
    expect(getReferenceCompletion("${{", 3, [])?.suggestions).toEqual([]);
  });

  it.each(["plain", "$", "${", "$${{cache", "${{cache.REDIS_URL}}", "${{cache\n", "${{cache}"])("ignores inactive or escaped input %s", (value) => {
    expect(getReferenceCompletion(value, value.length, suggestions)).toBeNull();
  });

  it("replaces an open reference while preserving its prefix and unrelated suffix", () => {
    const value = "prefix-${{ca/suffix";
    const completion = getReferenceCompletion(value, "prefix-${{ca".length, suggestions)!;
    expect(applyReferenceCompletion(value, completion, suggestions[1])).toEqual({
      value: "prefix-${{cache.REDIS_URL}}/suffix", caret: "prefix-${{cache.REDIS_URL}}".length,
    });
  });

  it("replaces the whole existing reference when editing before its closing braces", () => {
    const value = "${{web.TOKEN}}/${{ca.OLD}}/${{web.TOKEN}}";
    const completion = getReferenceCompletion(value, "${{web.TOKEN}}/${{ca".length, suggestions)!;
    expect(applyReferenceCompletion(value, completion, suggestions[1])).toEqual({
      value: "${{web.TOKEN}}/${{cache.REDIS_URL}}/${{web.TOKEN}}",
      caret: "${{web.TOKEN}}/${{cache.REDIS_URL}}".length,
    });
  });

  it("does not consume a subsequent reference when the current one is unfinished", () => {
    const value = "${{ca-${{web.TOKEN}}";
    const completion = getReferenceCompletion(value, 5, suggestions)!;
    expect(applyReferenceCompletion(value, completion, suggestions[1]).value).toBe("${{cache.REDIS_URL}}-${{web.TOKEN}}");
  });

  it("ignores an earlier escaped reference and completes the active one", () => {
    const value = "$${{literal}}/${{ca";
    expect(getReferenceCompletion(value, value.length, suggestions)?.suggestions).toEqual([suggestions[1]]);
  });

  it("wraps keyboard navigation in either direction and handles an empty list", () => {
    expect(referenceOptionIndex(0, "ArrowDown", 3)).toBe(1);
    expect(referenceOptionIndex(2, "ArrowDown", 3)).toBe(0);
    expect(referenceOptionIndex(0, "ArrowUp", 3)).toBe(2);
    expect(referenceOptionIndex(2, "ArrowUp", 3)).toBe(1);
    expect(referenceOptionIndex(0, "ArrowUp", 0)).toBe(0);
    expect(referenceOptionIndex(0, "ArrowDown", 1)).toBe(0);
  });
});

describe("validateReferenceSyntax", () => {
  it("flags unfinished, malformed, and empty references", () => {
    expect(validateReferenceSyntax("${{cache.REDIS_URL")).toEqual(["Finish the reference with }}."]);
    expect(validateReferenceSyntax("${{cache.REDIS_URL}")).toEqual(["Finish the reference with }}."]);
    expect(validateReferenceSyntax("${{bad{key}}")).toEqual(["Finish the reference with }}."]);
    expect(validateReferenceSyntax("${{ }}")).toEqual(["A reference cannot be empty."]);
  });

  it("accepts closed references, engine shared scopes, literals, and escaped openers", () => {
    expect(validateReferenceSyntax("${{Main DB.v2.DATABASE_URL}}/${{TOKEN}}/${{project.KEY}}/${{environment.KEY}}/${{vault.KEY}}")).toEqual([]);
    expect(validateReferenceSyntax("literal-$${{unfinished")).toEqual([]);
    expect(validateReferenceSyntax("literal")).toEqual([]);
  });
});

describe("validateVariableReferenceSyntax", () => {
  it("checks physical multiline rows immediately without resolving sibling values", () => {
    expect(validateVariableReferenceSyntax('# comment\nMULTI="first\n${{db.TOKEN\nlast"\nURL=${{db.TOKEN}}')).toEqual([
      { index: 1, key: "MULTI", message: "Finish the reference with }}." },
    ]);
  });

  it("keeps table row indices for duplicate and temporary keys", () => {
    expect(validateVariableReferenceSyntax("", [
      { index: 3, key: "#", value: "${{" },
      { index: 7, key: "URL", value: "${{ }}" },
      { index: 9, key: "URL", value: "${{db.TOKEN}}" },
    ])).toEqual([
      { index: 3, key: "#", message: "Finish the reference with }}." },
      { index: 7, key: "URL", message: "A reference cannot be empty." },
    ]);
  });
});

describe("validateVariableReferences", () => {
  const targets: RefTarget[] = [
    { name: "web", template: "OLD=stored-secret", builtins: { SWITCHYARD_HOST: "web-abc" } },
    { name: "db", template: "TOKEN=stored-db-secret", builtins: { DATABASE_URL: "resolved-db-secret" } },
  ];

  it("reports unknown service and variable names at physical row indices without exposing values", () => {
    const issues = validateVariableReferences("# comment\n\nURL=${{missing.DATABASE_URL}}\nTOKEN=${{db.MISSING}}", "web", targets);
    expect(issues).toEqual([
      { index: 2, key: "URL", message: 'No service named "missing".' },
      { index: 3, key: "TOKEN", message: '"db" has no variable MISSING (available: TOKEN, DATABASE_URL).' },
    ]);
    expect(JSON.stringify(issues)).not.toMatch(/secret|web-abc/);
  });

  it("validates references on later lines within quoted values", () => {
    const template = 'MULTI="first\n${{db.MISSING}}\nlast"\nURL=${{db.DATABASE_URL}}';
    expect(validateVariableReferences(template, "web", targets)).toEqual([
      { index: 0, key: "MULTI", message: '"db" has no variable MISSING (available: TOKEN, DATABASE_URL).' },
    ]);
  });

  it("validates each duplicate even when a later assignment would overwrite it", () => {
    expect(validateVariableReferences("URL=${{first.MISSING}}\nURL=${{db.DATABASE_URL}}\nURL=${{last.MISSING}}", "web", targets)).toEqual([
      { index: 0, key: "URL", message: 'No service named "first".' },
      { index: 2, key: "URL", message: 'No service named "last".' },
    ]);
  });

  it("resolves self references against the full current draft including built-ins", () => {
    const template = "LOCAL=new-secret\nALIAS=${{web.LOCAL}}\nURL=${{db.DATABASE_URL}}\nHOST=${{web.SWITCHYARD_HOST}}";
    expect(validateVariableReferences(template, "web", targets)).toEqual([]);
    expect(validateVariableReferences("OLD_ALIAS=${{web.OLD}}", "web", targets)[0].message).toContain("has no variable OLD");
  });

  it("reports draft self-reference cycles under the real variable names", () => {
    expect(validateVariableReferences("A=${{web.B}}\nB=${{web.A}}", "web", targets)).toEqual([
      { index: 0, key: "A", message: "Reference cycle: web.A → web.B → web.A." },
      { index: 1, key: "B", message: "Reference cycle: web.B → web.A → web.B." },
    ]);
  });

  it("checks syntax and unknown references even on an invalid-key row", () => {
    expect(validateVariableReferences("BAD KEY=${{missing.VALUE}}\nEMPTY=${{ }}\nOPEN=${{db.", "web", targets)).toEqual([
      { index: 0, key: "BAD KEY", message: 'No service named "missing".' },
      { index: 1, key: "EMPTY", message: "A reference cannot be empty." },
      { index: 2, key: "OPEN", message: "Finish the reference with }}." },
    ]);
  });

  it("preserves engine shared references and escaped literals", () => {
    expect(validateVariableReferences("SHARED=${{project.KEY}}\nENGINE=${{KEY}}\nESCAPED=$${{missing.VALUE}}", "web", targets)).toEqual([]);
  });

  it("keeps stable row indices and validates temporary keys that would parse as comments", () => {
    const rows = [
      { index: 3, key: "#", value: "${{missing.VALUE}}" },
      { index: 7, key: "TOKEN", value: "${{first.MISSING}}" },
      { index: 9, key: "TOKEN", value: "${{db.TOKEN}}" },
    ];
    expect(validateVariableReferences("#=${{missing.VALUE}}\nTOKEN=${{first.MISSING}}\nTOKEN=${{db.TOKEN}}", "web", targets, rows)).toEqual([
      { index: 3, key: "#", message: 'No service named "missing".' },
      { index: 7, key: "TOKEN", message: 'No service named "first".' },
    ]);
  });
});
