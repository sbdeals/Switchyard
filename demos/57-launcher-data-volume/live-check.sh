#!/usr/bin/env bash
# C-P2-5 live check, run against a disposable docker:27-dind daemon (NOT the host daemon)
export DOCKER_HOST=tcp://172.17.0.4:2375
echo; echo "===== step 1"
set -eu
set +x
umask 077
# Run from the repository root; change only this image selector.
SWITCHYARD_LIVE_IMAGE=switchyard-dash:integration-52fix-53-54-55
export SWITCHYARD_LIVE_IMAGE

docker info >/dev/null
docker image inspect "$SWITCHYARD_LIVE_IMAGE" >/dev/null
# Stop here if either fixed name already exists: choose a fresh daemon instead.
if docker container inspect switchyard >/dev/null 2>&1; then
  printf '%s\n' 'STOP: switchyard already exists; use a disposable daemon.' >&2
  exit 1
fi
if docker volume inspect switchyard-data >/dev/null 2>&1; then
  printf '%s\n' 'STOP: switchyard-data already exists; use a disposable daemon.' >&2
  exit 1
fi

# Swarm is needed for the platform teardown path. On a fresh daemon:
if [ "$(docker info --format '{{.Swarm.LocalNodeState}}')" != active ]; then
  docker swarm init >/dev/null
fi
if ! docker network inspect dokploy-network >/dev/null 2>&1; then
  docker network create dokploy-network  # bridge: nested-dind overlay attach times out >/dev/null
fi

# The localhost image repository has no registry in this fixture. The launcher's
# attempted pull is expected to fail, then use the already-present local image.
docker tag "$SWITCHYARD_LIVE_IMAGE" localhost/switchyard-cp25-live:before
docker tag "$SWITCHYARD_LIVE_IMAGE" localhost/switchyard-cp25-live:after

SWITCHYARD_LIVE_TMP=$(mktemp -d)
export SWITCHYARD_LIVE_TMP
export SWITCHYARD_CONFIG="$SWITCHYARD_LIVE_TMP/config.json"
chmod 700 "$SWITCHYARD_LIVE_TMP"
node --input-type=module <<'NODE'
import fs from 'node:fs';
fs.writeFileSync(process.env.SWITCHYARD_CONFIG, JSON.stringify({
  schemaVersion: 1,
  platform: 'docker-desktop',
  image: 'localhost/switchyard-cp25-live',
  imageTag: 'before',
  dashboardPort: 43001,
  store: false,
  skipTraefik: true,
  // No Dokploy account is needed for this storage-only fixture.
  adminEmail: '',
  adminPassword: '',
  sessionSecret: '',
  dokployUrlInContainer: 'http://127.0.0.1:9',
}), {mode: 0o600});
NODE
(cd cli && npm run build)

# Legacy layout: only the Docker socket mount; no /app/data mount or key override.
docker run -d --name switchyard --network dokploy-network \
  -p 127.0.0.1:43001:3001 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  localhost/switchyard-cp25-live:before >/dev/null
docker exec -i switchyard node <<'NODE'
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
assert.equal(os.homedir(), '/root');
fs.mkdirSync('/root/.switchyard', {recursive: true, mode: 0o700});
fs.writeFileSync('/root/.switchyard/agent-key.json', JSON.stringify({
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  key: 'dummy-' + crypto.randomBytes(32).toString('hex'),
  oauth: {refresh: 'dummy-' + crypto.randomBytes(32).toString('hex'), expiresAt: 4102444800000},
}), {mode: 0o600});
NODE
docker cp switchyard:/root/.switchyard/agent-key.json "$SWITCHYARD_LIVE_TMP/expected.json" >/dev/null
chmod 600 "$SWITCHYARD_LIVE_TMP/expected.json"
SWITCHYARD_LEGACY_ID=$(docker container inspect --format '{{.Id}}' switchyard)
echo; echo "===== step 2"
docker run --rm --entrypoint node \
  -v switchyard-data:/app/data localhost/switchyard-cp25-live:before \
  -e 'const f=require("node:fs");f.mkdirSync("/app/data/agent-key.json");require("node:assert/strict").equal(f.statSync("/app/data/agent-key.json").isDirectory(),true)'
if node cli/dist/cli.js config set imageTag after >"$SWITCHYARD_LIVE_TMP/migration-failure.log" 2>&1; then
  printf '%s\n' 'FAIL: replacement proceeded after failed migration.' >&2
  exit 1
fi
chmod 600 "$SWITCHYARD_LIVE_TMP/migration-failure.log"
node --input-type=module <<'NODE'
import fs from 'node:fs';
const output = fs.readFileSync(`${process.env.SWITCHYARD_LIVE_TMP}/migration-failure.log`, 'utf8');
if (!output.includes('Agent settings migration failed') ||
    output.includes('Could not determine the existing agent settings path')) {
  console.error('FAIL: migration did not reach the intended import failure; output retained privately in the fixture directory.');
  process.exit(1);
}
NODE
test "$SWITCHYARD_LEGACY_ID" = "$(docker container inspect --format '{{.Id}}' switchyard)"
test "$(docker container inspect --format '{{.State.Running}}' switchyard)" = true
docker cp switchyard:/root/.switchyard/agent-key.json "$SWITCHYARD_LIVE_TMP/retained.json" >/dev/null
chmod 600 "$SWITCHYARD_LIVE_TMP/retained.json"
cmp -s "$SWITCHYARD_LIVE_TMP/expected.json" "$SWITCHYARD_LIVE_TMP/retained.json"
docker run --rm --entrypoint node \
  -v switchyard-data:/app/data localhost/switchyard-cp25-live:before \
  -e 'require("node:fs").rmdirSync("/app/data/agent-key.json")'
printf '%s\n' 'PASS: migration failure preserved and restarted the old container.'
echo; echo "===== step 3"
node cli/dist/cli.js config set imageTag after
SWITCHYARD_MIGRATED_ID=$(docker container inspect --format '{{.Id}}' switchyard)
test "$SWITCHYARD_LEGACY_ID" != "$SWITCHYARD_MIGRATED_ID"
docker volume inspect switchyard-data >/dev/null
test "$(docker container inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}:{{.Name}}{{end}}{{end}}' switchyard)" = volume:switchyard-data

docker exec switchyard node -e 'const a=require("node:assert/strict"); const f=require("node:fs"); a.equal(process.env.SWITCHYARD_AGENT_KEY_FILE,"/app/data/agent-key.json"); a.equal(f.statSync(process.env.SWITCHYARD_AGENT_KEY_FILE).mode & 0o777,0o600);'
docker cp switchyard:/app/data/agent-key.json "$SWITCHYARD_LIVE_TMP/migrated.json" >/dev/null
chmod 600 "$SWITCHYARD_LIVE_TMP/migrated.json"
cmp -s "$SWITCHYARD_LIVE_TMP/expected.json" "$SWITCHYARD_LIVE_TMP/migrated.json"
printf '%s\n' 'PASS: legacy settings migrated byte-for-byte with mode 0600.'
echo; echo "===== step 4"
# An unchanged config must preserve the container ID.
node cli/dist/cli.js config set imageTag after
test "$SWITCHYARD_MIGRATED_ID" = "$(docker container inspect --format '{{.Id}}' switchyard)"

# Emulate another /app/data consumer (for example the DB backup feature).
docker exec switchyard node -e 'const f=require("node:fs"); f.mkdirSync("/app/data/backups",{recursive:true}); f.writeFileSync("/app/data/backups/cp25-fixture","backup fixture\n",{mode:0o600});'
# A changed image tag forces another normal replacement.
node cli/dist/cli.js config set imageTag before
test "$SWITCHYARD_MIGRATED_ID" != "$(docker container inspect --format '{{.Id}}' switchyard)"
docker cp switchyard:/app/data/agent-key.json "$SWITCHYARD_LIVE_TMP/replaced.json" >/dev/null
chmod 600 "$SWITCHYARD_LIVE_TMP/replaced.json"
cmp -s "$SWITCHYARD_LIVE_TMP/expected.json" "$SWITCHYARD_LIVE_TMP/replaced.json"
docker exec switchyard node -e 'require("node:assert/strict").equal(require("node:fs").readFileSync("/app/data/backups/cp25-fixture","utf8"),"backup fixture\n")'
printf '%s\n' 'PASS: unchanged config is idempotent; settings and backup files survive replacement.'
echo; echo "===== step 5"
node cli/dist/cli.js down --yes
if docker container inspect switchyard >/dev/null 2>&1; then
  printf '%s\n' 'FAIL: dashboard container still exists.' >&2
  exit 1
fi
docker volume inspect switchyard-data >/dev/null
# Inspect data through a temporary read-only mount, without showing contents.
docker run --rm --entrypoint node \
  -v switchyard-data:/app/data:ro localhost/switchyard-cp25-live:before \
  -e 'const a=require("node:assert/strict");const f=require("node:fs");a.equal(f.statSync("/app/data/agent-key.json").mode&0o777,0o600);a.equal(f.readFileSync("/app/data/backups/cp25-fixture","utf8"),"backup fixture\n");'
printf '%s\n' 'PASS: plain down kept dashboard data.'

node cli/dist/cli.js down --purge --yes
if docker volume inspect switchyard-data >/dev/null 2>&1; then
  printf '%s\n' 'FAIL: purge left switchyard-data behind.' >&2
  exit 1
fi
# A second purge should succeed when the volume is already absent.
node cli/dist/cli.js down --purge --yes
printf '%s\n' 'PASS: purge removed switchyard-data and repeated purge is idempotent.'
echo; echo "===== step 6"
node --input-type=module <<'NODE'
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync(process.env.SWITCHYARD_CONFIG, 'utf8'));
cfg.adminEmail = 'cp25-fixture@example.invalid';
cfg.adminPassword = 'non-secret-fixture-marker';
fs.writeFileSync(process.env.SWITCHYARD_CONFIG, JSON.stringify(cfg), {mode: 0o600});
NODE
docker create --name switchyard-cp25-volume-holder \
  -v switchyard-data:/app/data --entrypoint node \
  localhost/switchyard-cp25-live:before -e 'setInterval(()=>{},60000)' >/dev/null
if node cli/dist/cli.js down --purge --yes; then
  printf '%s\n' 'FAIL: purge reported success while data volume is in use.' >&2
  exit 1
fi
docker volume inspect switchyard-data >/dev/null
node --input-type=module <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const cfg = JSON.parse(fs.readFileSync(process.env.SWITCHYARD_CONFIG, 'utf8'));
assert.equal(cfg.adminEmail, 'cp25-fixture@example.invalid');
assert.equal(cfg.adminPassword, 'non-secret-fixture-marker');
NODE
docker rm switchyard-cp25-volume-holder >/dev/null
node cli/dist/cli.js down --purge --yes
if docker volume inspect switchyard-data >/dev/null 2>&1; then exit 1; fi
printf '%s\n' 'PASS: blocked purge failed explicitly, retained config, and succeeded after release.'
echo; echo "ALL STEPS PASSED"
