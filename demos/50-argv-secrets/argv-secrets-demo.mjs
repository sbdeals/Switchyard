#!/usr/bin/env node
// Usage: node /tmp/argv-secrets-demo.mjs /absolute/path/to/cli/dist
// Works with origin/main and the fix. Requires a normal, unminified tsup build.
// Only synthetic credentials are used. No real docker, sudo, shell script,
// network call, or container operation is executed.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const distArg = process.argv[2];
if (!distArg) {
  console.error("Usage: node /tmp/argv-secrets-demo.mjs /absolute/path/to/cli/dist");
  process.exit(2);
}
const synthetic = {
  adminPassword: "SYNTH-admin-pw-123",
  sessionSecret: "SYNTH-session-secret-456",
  storePassword: "SYNTH-store-pw-789",
};
const scratch = await mkdtemp(join(tmpdir(), "argv-secrets-demo-"));
const originalEnv = process.env;
const originalGetuid = Object.getOwnPropertyDescriptor(process, "getuid");

try {
  const dist = join(scratch, "dist");
  const bin = join(scratch, "bin");
  const capture = join(scratch, "calls.jsonl");
  await cp(resolve(distArg), dist, { recursive: true });
  await writeFile(join(scratch, "package.json"), '{"type":"module"}\n', { mode: 0o600 });
  await mkdir(bin);

  // Baseline lib.js does not export the two process-spawning helpers. Expose
  // the existing functions only in this disposable build copy. Remove the
  // CLI entry section before importing it, so no command can start implicitly.
  const owners = {};
  for (const name of await readdir(dist)) {
    if (!name.endsWith(".js")) continue;
    const path = join(dist, name);
    let source = await readFile(path, "utf8");
    if (name === "cli.js") {
      const entry = source.lastIndexOf("\n// src/cli.ts\n");
      assert(entry >= 0, "Unrecognized CLI build: expected the tsup src/cli.ts entry marker");
      source = source.slice(0, entry);
    }
    for (const helper of ["ensureSwitchyard", "linuxPlatform"]) {
      const declaration = helper === "linuxPlatform"
        ? /(?:var|let|const) linuxPlatform\s*=/
        : /(?:async )?function ensureSwitchyard\(/;
      if (declaration.test(source)) {
        assert(!owners[helper], `Multiple bundled definitions of ${helper}`);
        source += `\nexport { ${helper} as __argvDemo_${helper} };\n`;
        owners[helper] = path;
      }
    }
    await writeFile(path, source);
  }
  for (const helper of ["ensureSwitchyard", "linuxPlatform"]) {
    assert(owners[helper], `Unrecognized CLI build: cannot locate ${helper}`);
  }

  const fake = `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
const command = basename(process.argv[1]);
const argv = process.argv.slice(2);
const synthetic = ${JSON.stringify(Object.values(synthetic))};
appendFileSync(process.env.ARGV_DEMO_CAPTURE, JSON.stringify({
  command, argv,
  envNames: Object.keys(process.env).sort(),
  syntheticSecretEnvNames: Object.entries(process.env)
    .filter(([, value]) => synthetic.some(secret => value.includes(secret)))
    .map(([key]) => key).sort(),
}) + "\\n");
// The dashboard does not exist in this fictional Docker daemon.
if (command === "docker" && argv[0] === "inspect") process.exitCode = 1;
`;
  await writeFile(join(bin, "docker"), fake, { mode: 0o700 });
  await writeFile(join(bin, "sudo"), fake, { mode: 0o700 });
  await writeFile(capture, "", { mode: 0o600 });

  // Exclude all real environment values and prevent PATH fall-through to any
  // installed Docker/sudo. The fake commands use an absolute Node shebang.
  process.env = { PATH: bin, TMPDIR: scratch, ARGV_DEMO_CAPTURE: capture };
  Object.defineProperty(process, "getuid", { configurable: true, value: () => 1000 });

  const lib = await import(pathToFileURL(join(dist, "lib.js")).href);
  const cfg = { ...lib.defaultConfig("linux"), ...synthetic, adminEmail: "demo@example.invalid" };
  const plan = lib.renderContainer(cfg, "0.0.0-demo");
  console.log("Dashboard rendered docker argv:", JSON.stringify(plan.runArgs));
  printExposure("rendered dashboard argv", plan.runArgs);

  const { __argvDemo_ensureSwitchyard: ensureSwitchyard } = await import(pathToFileURL(owners.ensureSwitchyard).href);
  const { __argvDemo_linuxPlatform: linuxPlatform } = await import(pathToFileURL(owners.linuxPlatform).href);
  assert.equal(await ensureSwitchyard(cfg, "0.0.0-demo", () => {}), "created");
  const scripts = join(scratch, "scripts");
  await mkdir(scripts);
  for (const name of ["dokploy-up.sh", "switchyard-store-up.sh"]) {
    await writeFile(join(scripts, name), "#!/bin/bash\nexit 99\n", { mode: 0o700 });
  }
  await linuxPlatform.ensureDokploy(cfg, { force: true }, () => {});

  const calls = (await readFile(capture, "utf8")).trim().split("\n").map(JSON.parse);
  const run = calls.find(call => call.command === "docker" && call.argv[0] === "run");
  const sudo = calls.find(call => call.command === "sudo" && call.argv.some(arg => arg.endsWith("switchyard-store-up.sh")));
  assert(run, "Expected a fake docker run invocation");
  assert(sudo, "Expected a fake sudo invocation");
  for (const call of calls) {
    console.log(`Fake ${call.command} argv:`, JSON.stringify(call.argv));
    console.log(`Fake ${call.command} env names:`, JSON.stringify(call.envNames));
    if (call.syntheticSecretEnvNames.length) {
      console.log(`Fake ${call.command} env names containing synthetic credentials:`, JSON.stringify(call.syntheticSecretEnvNames));
    }
  }
  printExposure("spawned dashboard argv", run.argv);
  printExposure("spawned sudo argv", sudo.argv);
  console.log("Demo completed; no real commands or containers were used.");
} finally {
  process.env = originalEnv;
  if (originalGetuid) Object.defineProperty(process, "getuid", originalGetuid);
  else delete process.getuid;
  await rm(scratch, { recursive: true, force: true });
}

function printExposure(label, argv) {
  for (const [name, secret] of Object.entries(synthetic)) {
    console.log(`${label}: ${name} synthetic secret appears = ${argv.some(arg => arg.includes(secret))}`);
  }
}
