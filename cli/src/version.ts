// Injected by tsup's `define` from package.json at build time.
declare const __CLI_VERSION__: string | undefined;

export const CLI_VERSION: string =
  typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0-dev";
