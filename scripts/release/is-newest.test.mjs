import assert from "node:assert/strict";
import test from "node:test";

import { isNewest } from "./is-newest.mjs";

const fixtures = [
  ["newer published version exists", "v0.1.3", ["v0.1.2", "v0.1.4", "v0.1.3"], false],
  ["candidate is newest in unsorted history", "v0.1.4", ["v0.1.3", "v0.1.1", "v0.1.2"], true],
  ["equal version rerun", "v0.1.4", ["v0.1.4", "v0.1.3"], true],
  ["prerelease never becomes latest", "v0.2.0-rc.1", ["v0.1.4"], false],
  ["candidate without v prefix", "0.1.4", ["v0.1.3", "v0.1.4"], true],
  ["history without v prefix", "v0.1.3", ["0.1.4"], false],
  ["malformed entries are ignored", "v0.1.4", ["latest", "v9", "9.0", "v09.0.0", "release-9.0.0", "9.0.0+", null, {}, 7], true],
  ["higher prerelease tags are ignored", "v0.1.4", ["v9.0.0-beta.1"], true],
  ["first stable release", "v0.1.0", [], true],
  ["numeric components compare numerically", "v0.9.10", ["v0.10.0"], false],
  ["patch versions compare numerically", "v1.0.10", ["v1.0.9"], true],
  ["major takes precedence", "v2.0.0", ["v1.99.99"], true],
  ["large numeric components retain precision", "1.0.9007199254740992", ["1.0.9007199254740993"], false],
  ["build metadata does not affect precedence", "v1.2.3+build.2", ["1.2.3+build.9"], true],
  ["newer version with build metadata blocks promotion", "v1.2.3", ["v1.2.4+build.1"], false],
];

for (const [name, version, releases, expected] of fixtures) {
  test(name, () => assert.equal(isNewest(version, releases), expected));
}

test("draft and API-marked prerelease records are ignored", () => {
  assert.equal(isNewest("v0.1.4", [
    { tag_name: "v9.0.0", draft: true, prerelease: false },
    { tag_name: "v8.0.0", draft: false, prerelease: true },
    { tag_name: "v0.1.3", draft: false, prerelease: false },
  ]), true);
});

test("published stable release records participate in ordering", () => {
  assert.equal(isNewest("v0.1.3", [
    { tag_name: "v0.1.4", draft: false, prerelease: false },
  ]), false);
});

test("malformed candidates cannot become latest", () => {
  for (const version of ["", "latest", "v1.2", "v01.2.3", "1.2.3+", "1.2.3+bad_tag", "1.2.3\n"]) {
    assert.equal(isNewest(version, []), false, version);
  }
});

test("release history must be an array", () => {
  for (const releases of [null, {}, "v0.1.4"]) {
    assert.throws(() => isNewest("v0.1.4", releases), TypeError);
  }
});
