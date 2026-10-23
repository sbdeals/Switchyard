#!/usr/bin/env bash
# Usage: /tmp/purge-honesty-demo.sh /path/to/cli/dist[/cli.js]
# Requires node >=20 and bash. Builds nothing and never calls real Docker/sudo.
# Pass a build alongside its matching scripts: ../scripts (npm package) or
# ../../scripts (checkout), as required by the CLI's Linux script finder.
set -euo pipefail
if [ "$#" -ne 1 ]; then
  printf 'Usage: %s /path/to/cli/dist[/cli.js]\n' "$0" >&2
  exit 2
fi
CLI="$1"
[ ! -d "$CLI" ] || CLI="$CLI/cli.js"
[ -f "$CLI" ] || { printf 'CLI not found: %s\n' "$CLI" >&2; exit 2; }
CLI="$(cd "$(dirname "$CLI")" && pwd)/$(basename "$CLI")"
DEMO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/purge-honesty-demo.XXXXXX")"
trap 'rm -rf "$DEMO_DIR"' EXIT
# The CLI repairs executable bits on its scripts. Copy the supplied build and
# matching scripts so running this demo does not change checkout file modes.
DEMO_SCRIPTS=""
for candidate in "$(dirname "$CLI")/../scripts" "$(dirname "$CLI")/../../scripts"; do
  if [ -f "$candidate/dokploy-up.sh" ]; then DEMO_SCRIPTS="$candidate"; break; fi
done
[ -n "$DEMO_SCRIPTS" ] || { printf 'Cannot locate scripts beside %s\n' "$CLI" >&2; exit 2; }
mkdir -p "$DEMO_DIR/bin" "$DEMO_DIR/cli/dist" "$DEMO_DIR/scripts"
cp -R "$(dirname "$CLI")/." "$DEMO_DIR/cli/dist/"
cp -R "$DEMO_SCRIPTS/." "$DEMO_DIR/scripts/"
printf '{"type":"module"}\n' > "$DEMO_DIR/cli/package.json"
DEMO_CLI="$DEMO_DIR/cli/dist/$(basename "$CLI")"
cat > "$DEMO_DIR/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env node
// Fake Docker for purge integration tests and the standalone failure demo.
const fs = require("node:fs");
const args = process.argv.slice(2);
const path = process.env.PURGE_FAKE_STATE;
const state = JSON.parse(fs.readFileSync(path, "utf8"));
state.calls.push(args);

function finish(code = 0, stdout = "", stderr = "") {
  fs.writeFileSync(path, JSON.stringify(state));
  if (stdout) fs.writeSync(1, stdout + "\n");
  if (stderr) fs.writeSync(2, stderr + "\n");
  process.exit(code);
}

const [kind, action, ...rest] = args;
if (kind === "version") finish(0, "28.0.0");
if (kind === "info" || kind === "rm") finish();
if (kind === "service" && action === "rm") finish();
if (kind === "service" && action === "ls") {
  const busy = state.servicePolls > 0;
  if (busy) state.servicePolls--;
  finish(0, busy ? "dokploy" : "");
}
if (kind === "ps") {
  const busy = state.containerPolls > 0;
  if (busy) state.containerPolls--;
  const nameFilter = args.find((arg) => arg.startsWith("label=com.docker.swarm.service.name="));
  const matches = !nameFilter || nameFilter.endsWith("=dokploy");
  const format = args[args.indexOf("--format") + 1] || "";
  finish(0, busy && matches ? (format.includes("Label") ? "dokploy" : "fake-task") : "");
}

const resources = state.resources[kind];
if (resources && action === "ls") {
  if (state.listFailure === kind) finish(1, "", "Cannot connect to the Docker daemon");
  finish(0, resources.join("\n"));
}
if (resources && action === "inspect") {
  const name = rest.find((arg) => resources.includes(arg));
  if (name) finish(0, "[{}]");
  finish(1, "", `Error: No such ${kind}: ${rest[0]}`);
}
if (resources && action === "rm") {
  let code = 0;
  const errors = [];
  for (const name of rest.filter((arg) => !arg.startsWith("-"))) {
    const key = `${kind}/${name}`;
    state.attempts[key] = (state.attempts[key] || 0) + 1;
    const failures = state.failures[key] || 0;
    if (!resources.includes(name)) {
      code = 1;
      errors.push(`Error: No such ${kind}: ${name}`);
    } else if (failures === -1 || state.attempts[key] <= failures) {
      code = 1;
      errors.push(`Error response from daemon: ${kind} ${name} is in use`);
    } else {
      resources.splice(resources.indexOf(name), 1);
    }
  }
  finish(code, "", errors.join("\n"));
}
finish(99, "", `Unexpected fake Docker command: ${args.join(" ")}`);
FAKE_DOCKER
cat > "$DEMO_DIR/bin/id" <<'FAKE_ID'
#!/bin/sh
printf '0\n'
FAKE_ID
cat > "$DEMO_DIR/bin/sudo" <<'FAKE_SUDO'
#!/bin/sh
exec "$@"
FAKE_SUDO
cat > "$DEMO_DIR/bin/sleep" <<'FAKE_SLEEP'
#!/bin/sh
# Keep the demo quick; real purge retry sleeps are two seconds.
:
FAKE_SLEEP
chmod +x "$DEMO_DIR/bin/"*
export PATH="$DEMO_DIR/bin:$PATH"
export SWITCHYARD_CONFIG="$DEMO_DIR/config.json"
export PURGE_FAKE_STATE="$DEMO_DIR/docker.json"
export NO_COLOR=1
printf 'CLI: %s\n' "$CLI"
printf '%s\n' 'Using Linux config, fake docker/id/sudo on PATH, and accelerated shell sleeps.'
printf '%s\n' 'The CLI must resolve its matching bundled/repository scripts. No root or real Docker needed.'

prepare() {
  node - "$1" <<'INITIALIZE'
const fs = require("node:fs");
const scenario = process.argv[2];
const failures = scenario === "permanent"
  ? { "volume/dokploy-postgres": -1, "volume/switchyard-metrics": -1 }
  : scenario === "partial"
    ? { "volume/dokploy": -1 }
    : scenario === "transient"
      ? { "volume/dokploy": 2 }
      : {};
fs.writeFileSync(process.env.PURGE_FAKE_STATE, JSON.stringify({
  resources: {
    network: ["dokploy-network"],
    secret: ["dokploy_postgres_password", "dokploy_auth_secret"],
    volume: ["dokploy", "dokploy-postgres", "dokploy-redis", "switchyard-metrics"],
  },
  failures,
  attempts: {},
  calls: [],
}));
fs.writeFileSync(process.env.SWITCHYARD_CONFIG, JSON.stringify({
  schemaVersion: 1,
  platform: "linux",
  adminEmail: "admin@example.test",
  adminPassword: "synthetic-admin-password",
  storePassword: "synthetic-store-password",
}, null, 2) + "\n", { mode: 0o600 });
INITIALIZE
}

run() {
  printf '\n=== %s ===\n' "$1"
  # A regular file also makes the demo reliable in sandboxes that restrict pipes.
  local code=0
  node "$DEMO_CLI" down --purge --yes > "$DEMO_DIR/output.log" 2>&1 || code=$?
  cat "$DEMO_DIR/output.log"
  printf '\nExit code: %s\nConfig after scenario (synthetic credentials only):\n' "$code"
  cat "$SWITCHYARD_CONFIG"
  node - <<'SURVIVORS'
const fs = require("node:fs");
const state = JSON.parse(fs.readFileSync(process.env.PURGE_FAKE_STATE, "utf8"));
console.log("Fake Docker survivors:", JSON.stringify(state.resources));
console.log("Removal attempts:", JSON.stringify(state.attempts));
SURVIVORS
}

prepare permanent
run 'Permanent in-use postgres and metrics volumes: expect failure and all credentials kept'
prepare partial
run 'Partial removal, dokploy volume stuck: expect failure, admin credentials kept, store password cleared'
prepare transient
run 'Dokploy volume in use for first two attempts: expect third-attempt success and cleared credentials'
prepare success
run 'Full removal: expect success and cleared credentials'
run 'Already absent: expect idempotent success'
