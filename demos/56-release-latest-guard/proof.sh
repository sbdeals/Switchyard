set -euo pipefail
cd /workspace/wt-release-latest-guard
node --test scripts/release/*.test.mjs
# Direct execution also exposes every test's TAP output in this sandbox.
node scripts/release/is-newest.test.mjs
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isNewest } from "./scripts/release/is-newest.mjs";

const rows = [
  ["older/delayed", "v0.1.3", ["v0.1.4", "v0.1.2"], false],
  ["newest", "v0.1.4", ["v0.1.3", "v0.1.2"], true],
  ["equal rerun", "v0.1.4", ["v0.1.4"], true],
  ["prerelease", "v0.2.0-rc.1", ["v0.1.4"], false],
  ["mixed v prefixes", "0.1.3", ["v0.1.4"], false],
  ["malformed ignored", "v0.1.4", ["latest", "v9", "v09.0.0"], true],
  ["draft ignored", "v0.1.4", [{ tag_name: "v9.0.0", draft: true }], true],
  ["API prerelease ignored", "v0.1.4", [{ tag_name: "v9.0.0", prerelease: true }], true],
];
console.log("| case | version | before image latest | before make_latest | after image latest | after make_latest |");
console.log("|---|---|---|---|---|---|");
for (const [name, version, releases, expected] of rows) {
  const latest = isNewest(version, releases);
  assert.equal(latest, expected, name);
  console.log(`| ${name} | ${version} | true | true | ${latest} | ${latest} |`);
}

// Use the already available Node YAML parser; no installation required.
const require = createRequire(import.meta.url);
const yaml = require("./dashboard/node_modules/js-yaml");
const release = yaml.load(readFileSync(".github/workflows/release.yml", "utf8"));
const ci = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8"));
assert.equal(release.concurrency.group, "${{ github.workflow }}-${{ github.ref }}");
assert.equal(release.concurrency["cancel-in-progress"], false);
const meta = release.jobs.image.steps.find(step => step.id === "meta");
assert.equal(meta.with.flavor, "latest=false");
assert.equal(meta.with.tags.trim(), "type=semver,pattern={{version}}");
const publish = release.jobs.publish;
assert.equal(publish.concurrency.group, "${{ github.workflow }}-latest");
assert.equal(publish.concurrency["cancel-in-progress"], false);
assert.equal(publish.steps.filter(step => step.id === "latest").length, 1);
const promotion = publish.steps.find(step => step.name === "Promote the versioned image to latest");
assert.equal(promotion.if, "steps.latest.outputs.is_newest == 'true'");
assert.equal(promotion.env.IMAGE_TAG, "${{ needs.image.outputs.tag }}");
assert.equal(publish.steps.at(-1).env.MAKE_LATEST, "${{ steps.latest.outputs.is_newest }}");
assert(publish.steps.at(-1).run.includes('-f make_latest="$MAKE_LATEST"'));
assert(ci.jobs["release-guard"].steps.some(step => step.run === "node --test scripts/release/*.test.mjs"));
console.log("PASS: 8 decision rows; both YAML files and workflow guard assertions");
NODE

test "$(printf '%s' '["v0.1.4"]' | node scripts/release/is-newest.mjs v0.1.3)" = false
test "$(printf '%s' '["v0.1.4"]' | node scripts/release/is-newest.mjs v0.1.5)" = true
for invalid in '{invalid' '{}'; do
  if printf '%s' "$invalid" | node scripts/release/is-newest.mjs v0.1.4; then
    echo 'FAIL: malformed release history was accepted' >&2
    exit 1
  else
    test "$?" -eq 1
  fi
done
echo 'PASS: CLI false/true and both invalid-history cases'
git diff --check
