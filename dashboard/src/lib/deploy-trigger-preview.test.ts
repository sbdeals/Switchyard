import { describe, expect, it } from "vitest";
import { MAX_PREVIEW_PATHS, previewDeployTriggers } from "./deploy-trigger-preview";
import { MAX_WATCH_PATH_LENGTH } from "./deploy-triggers";

function matches(patterns: string[] | null, paths: string[]) {
  return previewDeployTriggers(true, patterns, paths).map((result) => result.matches);
}

describe("previewDeployTriggers", () => {
  it.each([null, []])("allows every example when watch paths are empty", (patterns) => {
    expect(previewDeployTriggers(true, patterns, ["src/app.ts", ".env"])).toEqual([
      { path: "src/app.ts", matches: true, triggers: true },
      { path: ".env", matches: true, triggers: true },
    ]);
  });

  it("keeps path match information when auto-deploy is disabled", () => {
    expect(previewDeployTriggers(false, ["src/**"], ["src/app.ts", "README.md"])).toEqual([
      { path: "src/app.ts", matches: true, triggers: false },
      { path: "README.md", matches: false, triggers: false },
    ]);
  });

  it("applies exclusions to the full pattern set and supports ordered reinclusion", () => {
    const paths = ["src/app.ts", "src/app.test.ts", "src/important.test.ts", "README.md"];
    expect(matches(["src/**", "!**/*.test.ts"], paths)).toEqual([true, false, false, false]);
    expect(matches(["src/**", "!**/*.test.ts", "src/important.test.ts"], paths))
      .toEqual([true, false, true, false]);
    expect(matches(["!**/*.test.ts", "src/**"], paths)).toEqual([true, true, true, false]);
  });

  it("allows all nonexcluded paths with only negative patterns", () => {
    expect(matches(["!docs/**", "!**/*.test.ts"], ["src/app.ts", "src/app.test.ts", "docs/README.md", "README.md"]))
      .toEqual([true, false, false, true]);
  });

  it("excludes dotfiles by default and allows explicit dot patterns", () => {
    const paths = ["src/.env", ".env", "src/app.ts", ".github/workflows/ci.yml"];
    expect(matches(["**/*"], paths)).toEqual([false, false, true, false]);
    expect(matches(["**/.env", ".github/**"], paths)).toEqual([true, true, false, true]);
  });

  it("matches case-sensitively and keeps stars within a path segment", () => {
    expect(matches(["src/*.ts"], ["src/app.ts", "src/APP.TS", "src/deep/app.ts", "app.ts"]))
      .toEqual([true, false, false, false]);
    expect(matches(["*.ts"], ["src/app.ts", "app.ts"])).toEqual([false, true]);
  });

  it("lets globstars match zero or multiple directories", () => {
    expect(matches(["src/**/*.ts"], ["src/app.ts", "src/deep/app.ts", "src/a/b/app.ts", "app.ts"]))
      .toEqual([true, true, true, false]);
  });

  it.each(["*.{ts,js}", "*.@(ts|js)"])("supports braces and extglobs: %s", (pattern) => {
    expect(matches([pattern], ["app.ts", "app.js", "app.css"])).toEqual([true, true, false]);
  });

  it("preserves duplicate examples and input order", () => {
    expect(previewDeployTriggers(true, ["*.ts"], ["app.ts", "app.css", "app.ts"]).map(({ path }) => path))
      .toEqual(["app.ts", "app.css", "app.ts"]);
  });

  it("returns no results for no examples", () => {
    expect(previewDeployTriggers(true, [], [])).toEqual([]);
    expect(previewDeployTriggers(true, ["src/**"], [])).toEqual([]);
  });

  it("allows the example count limit and rejects one extra", () => {
    const paths = Array.from({ length: MAX_PREVIEW_PATHS }, (_, index) => `src/${index}.ts`);
    expect(previewDeployTriggers(true, [], paths)).toHaveLength(MAX_PREVIEW_PATHS);
    expect(() => previewDeployTriggers(true, [], [...paths, "extra.ts"]))
      .toThrow(`Preview at most ${MAX_PREVIEW_PATHS}`);
  });

  it("allows the example length limit and rejects one extra character", () => {
    const path = "a".repeat(MAX_WATCH_PATH_LENGTH);
    expect(matches([], [path])).toEqual([true]);
    expect(() => previewDeployTriggers(true, [], [`${path}a`])).toThrow("Each example path");
  });

  it.each(["", "   ", null, 1, {}])("rejects invalid example paths: %s", (path) => {
    expect(() => previewDeployTriggers(true, [], [path] as string[])).toThrow("Each example path");
  });

  it.each([null, undefined, "src/app.ts", {}])("rejects a non-array example list: %s", (paths) => {
    expect(() => previewDeployTriggers(true, [], paths as string[])).toThrow("Preview at most");
  });

  it.each(["\u0000", "\n", "\r", "\t", "\u007f"])("rejects controls in example paths", (character) => {
    expect(() => previewDeployTriggers(true, [], [`src/${character}app.ts`])).toThrow("control characters");
  });
});
