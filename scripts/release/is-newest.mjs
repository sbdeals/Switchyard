#!/usr/bin/env node
// Usage: node scripts/release/is-newest.mjs v1.2.3 < releases.json
// Input: a JSON array of tags/versions or GitHub REST release objects.
// Only stable SemVer participates; build metadata does not affect precedence.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function stableVersion(tag) {
  if (typeof tag !== "string") return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(tag);
  if (!match || match[0] !== tag) return null;
  return match.slice(1, 4).map(BigInt);
}

export function isNewest(version, releases) {
  if (!Array.isArray(releases)) throw new TypeError("Expected a JSON array of releases");
  const current = stableVersion(version);
  if (!current) return false;

  return releases.every((release) => {
    if (release?.draft || release?.prerelease) return true;
    const other = stableVersion(typeof release === "string" ? release : release?.tag_name);
    if (!other) return true;
    for (let i = 0; i < current.length; i++) {
      if (other[i] !== current[i]) return other[i] < current[i];
    }
    return true; // Equal-version reruns may still promote latest.
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: is-newest.mjs <version> < releases.json");
    console.log(isNewest(process.argv[2], JSON.parse(readFileSync(0, "utf8"))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
