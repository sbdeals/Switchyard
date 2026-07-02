import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  // cli: the bin entry (shebang comes from the source file).
  // lib: pure helpers re-exported for the node:test suite in test/.
  entry: { cli: "src/cli.ts", lib: "src/lib.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  splitting: true,
  clean: true,
  // Bundle every dependency into the artifact: `npx switchyard-cli` then
  // installs a package with zero runtime deps, which keeps the one-liner fast.
  noExternal: [/.*/],
  // CJS deps (commander) require() node builtins at runtime; ESM output needs
  // a real `require` in scope. esbuild keeps the entry's shebang above this.
  banner: {
    js: 'import { createRequire as __cr } from "node:module"; const require = /* @__PURE__ */ __cr(import.meta.url);',
  },
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
});
