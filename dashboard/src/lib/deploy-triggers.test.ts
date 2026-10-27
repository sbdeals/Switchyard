import { describe, expect, it } from "vitest";
import {
  isGitSource,
  MAX_WATCH_PATH_LENGTH,
  MAX_WATCH_PATHS,
  MAX_WATCH_PATHS_LENGTH,
  parseDeployTriggers,
} from "./deploy-triggers";

describe("parseDeployTriggers", () => {
  it("trims lines, ignores blank lines, and preserves order and negations", () => {
    expect(parseDeployTriggers({
      autoDeploy: true,
      watchPaths: "\n src/** \r\n\r\n !**/*.test.ts\n src/important.test.ts \r README.md ",
    })).toEqual({
      autoDeploy: true,
      watchPaths: ["src/**", "!**/*.test.ts", "src/important.test.ts", "README.md"],
    });
  });

  it("allows empty patterns and preserves disabled auto-deploy", () => {
    expect(parseDeployTriggers({ autoDeploy: false, watchPaths: " \n\r\n " }))
      .toEqual({ autoDeploy: false, watchPaths: [] });
  });

  it.each([null, undefined, false, 1, "settings", []])("rejects invalid settings: %s", (input) => {
    expect(() => parseDeployTriggers(input)).toThrow("Invalid deploy trigger settings");
  });

  it.each([undefined, null, "true", 1, {}])("rejects nonboolean auto-deploy: %s", (autoDeploy) => {
    expect(() => parseDeployTriggers({ autoDeploy, watchPaths: "" }))
      .toThrow("Auto-deploy must be enabled or disabled");
  });

  it.each([undefined, null, true, 1, ["src/**"], {}])("rejects nontext watch paths: %s", (watchPaths) => {
    expect(() => parseDeployTriggers({ autoDeploy: true, watchPaths }))
      .toThrow("Watch paths must contain one glob per line");
  });

  it.each(["\u0000", "\t", "\u000b", "\u001f", "\u007f"])("rejects control characters", (character) => {
    expect(() => parseDeployTriggers({ autoDeploy: true, watchPaths: `src/${character}*` }))
      .toThrow("control characters");
  });

  it.each(["!", "!!", "!!!"])("rejects bare negation: %s", (watchPaths) => {
    expect(() => parseDeployTriggers({ autoDeploy: true, watchPaths })).toThrow("include a glob");
  });

  it("preserves supported glob syntax without imposing a different glob parser", () => {
    const patterns = ["!docs/**", "*.{ts,js}", "*.@(ts|js)", "!(README).md", "src/[ab].ts"];
    expect(parseDeployTriggers({ autoDeploy: true, watchPaths: patterns.join("\n") }).watchPaths)
      .toEqual(patterns);
  });

  it("allows the maximum individual pattern length and rejects one more character", () => {
    const watchPaths = "a".repeat(MAX_WATCH_PATH_LENGTH);
    expect(parseDeployTriggers({ autoDeploy: true, watchPaths }).watchPaths).toEqual([watchPaths]);
    expect(() => parseDeployTriggers({ autoDeploy: true, watchPaths: `${watchPaths}a` }))
      .toThrow(`Each watch path must be at most ${MAX_WATCH_PATH_LENGTH}`);
  });

  it("allows the maximum pattern count and rejects one more pattern", () => {
    const watchPaths = Array.from({ length: MAX_WATCH_PATHS }, (_, index) => `src/${index}/*`).join("\n");
    expect(parseDeployTriggers({ autoDeploy: true, watchPaths }).watchPaths).toHaveLength(MAX_WATCH_PATHS);
    expect(() => parseDeployTriggers({ autoDeploy: true, watchPaths: `${watchPaths}\nextra/*` }))
      .toThrow(`Use at most ${MAX_WATCH_PATHS}`);
  });

  it("bounds the complete textarea including blank lines before splitting", () => {
    const watchPaths = "\n".repeat(MAX_WATCH_PATHS_LENGTH);
    expect(parseDeployTriggers({ autoDeploy: true, watchPaths }).watchPaths).toEqual([]);
    expect(() => parseDeployTriggers({ autoDeploy: true, watchPaths: `${watchPaths}\n` }))
      .toThrow(`Watch paths must be at most ${MAX_WATCH_PATHS_LENGTH}`);
  });
});

describe("isGitSource", () => {
  it.each(["git", "github", "gitlab", "bitbucket", "gitea"])("accepts %s", (source) => {
    expect(isGitSource(source)).toBe(true);
  });

  it.each(["docker", "drop", "raw", "Github", "", undefined, null, {}, 1])("rejects %s", (source) => {
    expect(isGitSource(source)).toBe(false);
  });
});
