import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { defaultConfig, linuxPlatform, runScript } from "../dist/lib.js";

const lib = fileURLToPath(new URL("../../scripts/lib.sh", import.meta.url));
const password = "SYNTH-store-pw-123 ' \" $HOME `whoami` = \\ \nsecond line\n";
const needsBash = { skip: process.platform === "win32" };

async function withFakeSudo(t, fn) {
  const dir = mkdtempSync(join(tmpdir(), "switchyard-linux-test-"));
  const previousEnv = { ...process.env };
  t.mock.method(process, "getuid", () => 1000);
  try {
    Object.assign(process.env, {
      PATH: `${dir}:${process.env.PATH}`,
      SWITCHYARD_TEST_RECORD: join(dir, "sudo.jsonl"),
      SWITCHYARD_TEST_OUTPUT: join(dir, "output.json"),
      SWITCHYARD_TEST_LIB: lib,
      SWITCHYARD_TEST_READER: join(dir, "read-env.mjs"),
      SWITCHYARD_TEST_NODE: process.execPath,
      SWITCHYARD_TEST_EXIT: "0",
    });
    delete process.env.SWITCHYARD_METRICS_PASSWORD;
    delete process.env.SWITCHYARD_ENV_FILE;
    delete process.env.SWITCHYARD_TEST_CAPTURE_ONLY;
    writeFileSync(join(dir, "sudo"), `#!${process.execPath}
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const env = { ...process.env };
const command = args.indexOf("bash");
for (const pair of args.slice(0, command)) {
  const index = pair.indexOf("=");
  env[pair.slice(0, index)] = pair.slice(index + 1);
}
const file = env.SWITCHYARD_ENV_FILE;
appendFileSync(process.env.SWITCHYARD_TEST_RECORD, JSON.stringify({
  args,
  file,
  mode: file && (statSync(file).mode & 0o777),
  dirMode: file && (statSync(dirname(file)).mode & 0o777),
  contents: file && readFileSync(file, "utf8"),
}) + "\\n");
if (process.env.SWITCHYARD_TEST_CAPTURE_ONLY === "1") process.exit(0);
const result = spawnSync(args[command], args.slice(command + 1), { env, stdio: "inherit" });
process.exit(result.status ?? 1);
`, { mode: 0o755 });
    writeFileSync(join(dir, "read-env.mjs"), `
import { writeFileSync } from "node:fs";
writeFileSync(process.env.SWITCHYARD_TEST_OUTPUT, JSON.stringify({
  password: process.env.SWITCHYARD_METRICS_PASSWORD,
  force: process.env.FORCE,
  file: process.env.SWITCHYARD_ENV_FILE,
  args: process.argv.slice(2),
}));
process.exit(Number(process.env.SWITCHYARD_TEST_EXIT));
`);
    const script = join(dir, "read-env.sh");
    writeFileSync(script, '. "$SWITCHYARD_TEST_LIB"\n"$SWITCHYARD_TEST_NODE" "$SWITCHYARD_TEST_READER" "$@"\n');
    await fn({ dir, script, records: () => readFileSync(process.env.SWITCHYARD_TEST_RECORD, "utf8").trim().split("\n").map(JSON.parse) });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    t.mock.restoreAll();
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const code of [0, 17]) {
  test(`sudo keeps secrets in a private env file and cleans up after exit ${code}`, needsBash, async (t) => {
    await withFakeSudo(t, async ({ script, records }) => {
      process.env.SWITCHYARD_TEST_EXIT = String(code);
      assert.equal(await runScript(script, ["FORCE=1"], ["script argument"], { SWITCHYARD_METRICS_PASSWORD: password }), code);
      const [record] = records();
      assert.equal(record.args.some((arg) => arg.includes(password)), false);
      assert.equal(record.args.some((arg) => arg.startsWith("SWITCHYARD_METRICS_PASSWORD=")), false);
      assert.equal(record.mode, 0o600);
      assert.equal(record.dirMode, 0o700);
      assert.ok(record.contents.includes("SYNTH-store-pw-123"));
      assert.deepEqual(JSON.parse(readFileSync(process.env.SWITCHYARD_TEST_OUTPUT, "utf8")), {
        password,
        force: "1",
        args: ["script argument"],
      });
      assert.equal(existsSync(dirname(record.file)), false);
    });
  });
}

test("sudo env file is removed when sudo cannot spawn", needsBash, async (t) => {
  await withFakeSudo(t, async ({ dir, script }) => {
    process.env.PATH = join(dir, "missing-path");
    process.env.TMPDIR = dir;
    assert.equal(await runScript(script, [], [], { SWITCHYARD_METRICS_PASSWORD: password }), 127);
    assert.equal(readdirSync(dir).some((name) => name.startsWith("switchyard-env-")), false);
  });
});

test("Linux metrics provisioning passes its password through the private env file", needsBash, async (t) => {
  await withFakeSudo(t, async ({ records }) => {
    process.env.SWITCHYARD_TEST_CAPTURE_ONLY = "1";
    const modes = readdirSync(dirname(lib)).filter((name) => name.endsWith(".sh")).map((name) => {
      const file = join(dirname(lib), name);
      return [file, statSync(file).mode & 0o777];
    });
    try {
      await linuxPlatform.ensureDokploy({ ...defaultConfig("linux"), store: true, storePassword: password }, {}, () => {});
    } finally {
      for (const [file, mode] of modes) chmodSync(file, mode);
    }
    const calls = records();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].file, undefined);
    assert.ok(calls[1].args.some((arg) => arg.endsWith("switchyard-store-up.sh")));
    assert.equal(calls.some(({ args }) => args.some((arg) => arg.includes(password))), false);
    assert.ok(calls[1].contents.includes("SYNTH-store-pw-123"));
    assert.equal(existsSync(dirname(calls[1].file)), false);
  });
});

test("root scripts receive secret env directly without sudo", needsBash, async (t) => {
  await withFakeSudo(t, async ({ script }) => {
    t.mock.method(process, "getuid", () => 0);
    assert.equal(await runScript(script, ["FORCE=1"], [], { SWITCHYARD_METRICS_PASSWORD: password }), 0);
    assert.equal(existsSync(process.env.SWITCHYARD_TEST_RECORD), false);
    assert.equal(JSON.parse(readFileSync(process.env.SWITCHYARD_TEST_OUTPUT, "utf8")).password, password);
  });
});

test("direct script callers can still export secrets without an env file", needsBash, () => {
  const env = { ...process.env, SWITCHYARD_METRICS_PASSWORD: password };
  delete env.SWITCHYARD_ENV_FILE;
  const result = spawnSync("bash", ["-c", '. "$1"; printf "%s" "$SWITCHYARD_METRICS_PASSWORD"', "bash", lib], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, password);
});
