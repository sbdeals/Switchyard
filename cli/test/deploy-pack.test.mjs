import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

import { DEFAULT_DEPLOY_MAX_BYTES, packDirectory } from "../dist/lib.js";

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}

function unzip(archive) {
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  const entries = new Map();
  let central = archive.readUInt32LE(end + 16);
  for (let index = 0; index < archive.readUInt16LE(end + 10); index++) {
    assert.equal(archive.readUInt32LE(central), 0x02014b50);
    const nameLength = archive.readUInt16LE(central + 28);
    const name = archive.subarray(central + 46, central + 46 + nameLength).toString();
    const local = archive.readUInt32LE(central + 42);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    assert.equal(archive.readUInt16LE(local + 6), 0x800);
    assert.equal(archive.subarray(local + 30, local + 30 + nameLength).toString(), name);
    const compressed = archive.subarray(local + 30 + nameLength, local + 30 + nameLength + archive.readUInt32LE(central + 20));
    const data = archive.readUInt16LE(central + 10) === 8 ? inflateRawSync(compressed) : compressed;
    assert.equal(data.length, archive.readUInt32LE(central + 24));
    entries.set(name, { data, mode: archive.readUInt32LE(central + 38) >>> 16 });
    central += 46 + nameLength;
  }
  assert.equal(central, end);
  return entries;
}

test("packDirectory creates a root-relative ZIP with bytes, executable modes, and empty directories", async (t) => {
  const root = await fixture(t, {
    Dockerfile: "FROM scratch\nCOPY . /app\n",
    "scripts/start.sh": "#!/bin/sh\necho hello\n",
    "café.txt": "hello ☕\n",
  });
  await chmod(join(root, "scripts/start.sh"), 0o755);
  await mkdir(join(root, "empty"));
  const result = await packDirectory(root);
  const entries = unzip(result.archive);
  assert.deepEqual([...entries.keys()].sort(), ["Dockerfile", "café.txt", "empty/", "scripts/", "scripts/start.sh"].sort());
  assert.equal(entries.get("café.txt").data.toString(), "hello ☕\n");
  assert.equal(entries.get("scripts/start.sh").mode & 0o777, 0o755);
  assert.equal(entries.get("empty/").mode & 0o170000, 0o040000);
  assert.equal(result.totalBytes, [...entries.values()].reduce((sum, entry) => sum + entry.data.length, 0));
  assert.equal(result.hasDockerfile, true);
  assert.deepEqual(result.skippedSymlinks, []);
  assert.deepEqual(result.archive, (await packDirectory(root)).archive);
});

test("packDirectory applies nested git ignores, anchored patterns, negation, and immutable exclusions", async (t) => {
  const root = await fixture(t, {
    ".gitignore": "# comment\n*.log\n!keep.log\n/root-only.txt\ncache/\nblocked/\n!blocked/visible.txt\n!.git/\n!node_modules/\n\\#literal\n\\!literal\n",
    Dockerfile: "FROM scratch",
    "drop.log": "omit",
    "keep.log": "keep",
    "root-only.txt": "omit",
    "nested/root-only.txt": "keep",
    "nested/drop.log": "omit",
    "nested/keep.log": "keep",
    "nested/.gitignore": "/local.txt\n!restore.log\n",
    "nested/local.txt": "omit",
    "nested/deeper/local.txt": "keep",
    "nested/restore.log": "keep",
    "nested/cache/data.txt": "omit",
    "blocked/visible.txt": "omit",
    "#literal": "omit",
    "!literal": "omit",
    ".git/config": "omit",
    "nested/.git": "omit",
    "node_modules/module.js": "omit",
    "nested/node_modules/module.js": "omit",
  });
  const packed = await packDirectory(root);
  assert.deepEqual(packed.files.sort(), [".gitignore", "Dockerfile", "keep.log", "nested/.gitignore", "nested/deeper/local.txt", "nested/keep.log", "nested/restore.log", "nested/root-only.txt"].sort());
  assert.deepEqual([...unzip(packed.archive).values()].filter((entry) => entry.data.toString() === "omit"), []);
});

test("packDirectory applies Docker wildcards and parent negation independently of Git", async (t) => {
  const root = await fixture(t, {
    ".gitignore": "git-only.txt\n",
    ".dockerignore": "**/*.bak\noutput/\n!output/keep.txt\nnotes?.txt\n[ab].tmp\n!git-only.txt\n*.md\nDockerfile\n.dockerignore\n",
    Dockerfile: "FROM scratch",
    "git-only.txt": "omit",
    "nested/remove.bak": "omit",
    "root.bak": "omit",
    "output/remove.txt": "omit",
    "output/keep.txt": "keep",
    "notes1.txt": "omit",
    "a.tmp": "omit",
    "c.tmp": "keep",
    "root.md": "omit",
    "nested/keep.md": "keep",
    "nested/.dockerignore": "keep.md\n",
  });
  const packed = await packDirectory(root);
  assert.deepEqual(packed.files.sort(), [".gitignore", ".dockerignore", "Dockerfile", "c.tmp", "nested/keep.md", "nested/.dockerignore", "output/keep.txt"].sort());
  assert.equal(packed.hasDockerfile, true);
});

test("packDirectory excludes env files at every depth despite ignore negations, keeping examples", async (t) => {
  const root = await fixture(t, {
    ".gitignore": "!.env*\n!.switchyard/\n",
    ".dockerignore": "!**/.env*\n!**/.switchyard/**\n",
    Dockerfile: "FROM scratch",
    ".env": "PRIVATE=root",
    ".env.local": "PRIVATE=local",
    ".env.example": "PUBLIC=example",
    ".env.example.local": "PRIVATE=example-local",
    ".envrc": "keep",
    "nested/.env": "PRIVATE=nested",
    "nested/.env.production": "PRIVATE=production",
    "nested/.env.example": "PUBLIC=nested-example",
    ".switchyard/link.json": "omit",
    "nested/.switchyard/link.json": "omit",
  });
  const packed = await packDirectory(root);
  assert.deepEqual(packed.excludedEnvFiles.sort(), [".env", ".env.example.local", ".env.local", "nested/.env", "nested/.env.production"].sort());
  assert.deepEqual(packed.files.sort(), [".dockerignore", ".env.example", ".envrc", ".gitignore", "Dockerfile", "nested/.env.example"].sort());
  const entries = unzip(packed.archive);
  assert.ok([...entries.keys()].every((name) => !name.includes(".switchyard")));
  assert.ok([...entries.values()].every((entry) => !entry.data.toString().startsWith("PRIVATE=")));
});

test("packDirectory includeEnv opts into env files while honoring ignores and excluding local links", async (t) => {
  const root = await fixture(t, {
    ".gitignore": ".env.gitignored\n.env.example\n!.switchyard/\n",
    ".dockerignore": "**/.env.dockerignored\n!**/.switchyard/**\n",
    ".env": "PRIVATE=root",
    ".env.gitignored": "omit",
    ".env.example": "omit",
    "nested/.env.local": "PRIVATE=nested",
    "nested/.env.dockerignored": "omit",
    ".switchyard/link.json": "omit",
    "nested/.switchyard/link.json": "omit",
  });
  const packed = await packDirectory(root, { includeEnv: true });
  assert.deepEqual(packed.excludedEnvFiles, []);
  assert.deepEqual(packed.files.sort(), [".dockerignore", ".env", ".gitignore", "nested/.env.local"].sort());
  const entries = unzip(packed.archive);
  assert.equal(entries.get(".env").data.toString(), "PRIVATE=root");
  assert.equal(entries.get("nested/.env.local").data.toString(), "PRIVATE=nested");
  assert.ok([...entries.keys()].every((name) => !name.includes(".switchyard")));
});

test("packDirectory skips excluded env files before reading or counting their bytes", async (t) => {
  const root = await fixture(t, {
    Dockerfile: "FROM scratch",
    ".env": "x".repeat(4097),
    "nested/.env.secret": "x".repeat(4097),
    ".switchyard/.gitignore": "x".repeat(4097),
  });
  const packed = await packDirectory(root, { maxBytes: 4096 });
  assert.deepEqual(packed.files, ["Dockerfile"]);
  assert.deepEqual(packed.excludedEnvFiles, [".env", "nested/.env.secret"]);
  assert.equal(packed.totalBytes, Buffer.byteLength("FROM scratch"));
  await assert.rejects(packDirectory(root, { maxBytes: 4096, includeEnv: true }), /upload too large/);
});

test("packDirectory honors Dockerfile-specific ignores and detects a Git-excluded Dockerfile", async (t) => {
  const root = await fixture(t, {
    ".gitignore": "Dockerfile\n",
    ".dockerignore": "root-rule.txt\n",
    "Dockerfile.dockerignore": "specific-rule.txt\n",
    Dockerfile: "FROM scratch",
    "root-rule.txt": "keep",
    "specific-rule.txt": "omit",
  });
  const packed = await packDirectory(root);
  assert.equal(packed.hasDockerfile, false);
  assert.ok(packed.files.includes("root-rule.txt"));
  assert.ok(!packed.files.includes("specific-rule.txt"));
});

test("packDirectory never follows file, directory, or ignore-file symlinks", async (t) => {
  const root = await fixture(t, { Dockerfile: "FROM scratch", "keep.txt": "keep" });
  const outside = await fixture(t, { "outside.txt": "not uploaded" });
  await symlink(join(outside, "outside.txt"), join(root, "linked.txt"));
  await symlink(outside, join(root, "linked-dir"));
  await symlink(join(outside, "outside.txt"), join(root, ".gitignore"));
  const packed = await packDirectory(root);
  assert.deepEqual(packed.files.sort(), ["Dockerfile", "keep.txt"]);
  assert.deepEqual(packed.skippedSymlinks.sort(), [".gitignore", "linked-dir", "linked.txt"]);
  assert.equal(unzip(packed.archive).size, 2);
});

test("packDirectory caps included bytes before compression, including cumulative input", async (t) => {
  assert.equal(DEFAULT_DEPLOY_MAX_BYTES, 100 * 1024 * 1024);
  const oversized = await fixture(t, { "large.txt": "a".repeat(4097) });
  await assert.rejects(packDirectory(oversized, { maxBytes: 4096 }), /upload too large.*4096 bytes.*\.dockerignore/);
  const cumulative = await fixture(t, { "one.txt": "a".repeat(3000), "two.txt": "b".repeat(3000) });
  await assert.rejects(packDirectory(cumulative, { maxBytes: 4096 }), /upload too large/);
  const excluded = await fixture(t, { ".gitignore": "large.txt\n", "large.txt": "a".repeat(4097), Dockerfile: "FROM scratch" });
  assert.equal((await packDirectory(excluded, { maxBytes: 4096 })).hasDockerfile, true);
});

test("packDirectory caps ZIP overhead and reports invalid paths clearly", async (t) => {
  const root = await fixture(t, { "empty-file.txt": "" });
  await assert.rejects(packDirectory(root, { maxBytes: 100 }), /upload too large/);
  await assert.rejects(packDirectory(root, { maxBytes: 0 }), /Archive size limit/);
  await assert.rejects(packDirectory(join(root, "missing")), /not a readable directory/);
  await assert.rejects(packDirectory(join(root, "empty-file.txt")), /not a readable directory/);
});

test("packDirectory does not read inside Docker-excluded directories without exceptions", async (t) => {
  const root = await fixture(t, {
    Dockerfile: "FROM scratch",
    ".dockerignore": "excluded/\n",
    "excluded/.gitignore": "a".repeat(4097),
  });
  assert.deepEqual((await packDirectory(root, { maxBytes: 4096 })).files.sort(), [".dockerignore", "Dockerfile"]);
});
