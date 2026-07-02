// prepack hook: copy the repo's canonical scripts/ into cli/scripts so the
// published npm package ships them (package.json "files" includes "scripts").
// The copy is created at pack time and gitignored — it can never drift in a
// published artifact, and the source of truth stays the repo root.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const src = new URL("../scripts", import.meta.url);
const dest = new URL("./scripts", import.meta.url);

if (!existsSync(src)) {
  // Packing outside the repo (e.g. from a published tarball) — scripts are
  // already in place; nothing to copy.
  if (existsSync(dest)) process.exit(0);
  console.error(`copy-scripts: ${fileURLToPath(src)} not found and no local copy exists`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-scripts: copied repo scripts/ -> ${fileURLToPath(dest)} (from ${here})`);
