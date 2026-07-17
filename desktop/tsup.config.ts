import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const cliPkg = JSON.parse(readFileSync(new URL("../cli/package.json", import.meta.url), "utf8"));

export default defineConfig({
  // main: Electron main process (bundles ../cli/src core modules directly —
  // the desktop app IS the CLI's docker-desktop path with a GUI on top).
  // preload: contextBridge shim for the status/wizard views.
  entry: { main: "src/main/index.ts", preload: "src/preload.ts" },
  // CJS because sandboxed Electron preloads must be CommonJS; the cli sources
  // bundle fine as CJS (platform/linux.ts is the only import.meta user and the
  // desktop app deliberately never imports it — Windows/macOS only).
  format: "cjs",
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  target: "node20",
  clean: true,
  // electron is provided by the runtime; electron-updater ships as a real
  // node_modules dependency so electron-builder packages it conventionally.
  external: ["electron", "electron-updater"],
  // Static renderer assets (HTML/CSS/JS + generated tray/window icons) are
  // copied next to the bundles so dist/ is the complete app payload.
  publicDir: "src/renderer",
  define: {
    // The cli sources version-tag the dashboard image with __CLI_VERSION__;
    // inject the same value the published CLI would use so the desktop app
    // converges on the identical container spec (hash-stable with `up`).
    __CLI_VERSION__: JSON.stringify(cliPkg.version),
    __DESKTOP_VERSION__: JSON.stringify(pkg.version),
  },
});
