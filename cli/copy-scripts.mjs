// prepack hook: copy the repo's canonical scripts/ into cli/scripts so the
// published npm package ships them (package.json "files" includes "scripts").
// The copy is created at pack time and gitignored — it can never drift in a
// published artifact, and the source of truth stays the repo root.
//
// Line endings are normalized to LF while copying: a Windows checkout can
// have CRLF working-tree files, and CRLF shell scripts break Linux bash
// ("$'\r': command not found" — hit for real on the first VPS deploy).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../scripts", import.meta.url));
const dest = fileURLToPath(new URL("./scripts", import.meta.url));

if (!existsSync(src)) {
  // Packing outside the repo (e.g. from a published tarball) — scripts are
  // already in place; nothing to copy.
  if (existsSync(dest)) process.exit(0);
  console.error(`copy-scripts: ${src} not found and no local copy exists`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
let count = 0;
for (const name of readdirSync(src)) {
  const content = readFileSync(join(src, name), "utf8").replaceAll("\r\n", "\n");
  writeFileSync(join(dest, name), content, "utf8");
  count++;
}
console.log(`copy-scripts: copied ${count} scripts -> ${dest} (LF-normalized)`);
