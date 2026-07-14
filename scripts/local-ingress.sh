#!/usr/bin/env bash
# Opt-in, best-effort LOCAL ingress — demonstrate domain routing on Docker
# Desktop, where `switchyard up` sets skipTraefik and domains do not route.
#
# On Linux the CLI runs a real Traefik on 80/443 and issues Let's Encrypt certs.
# On Docker Desktop those ports are usually taken by other software, so this
# script runs a SECOND Traefik on ALTERNATE host ports, reusing the exact
# config Dokploy already generates under /etc/dokploy/traefik. That lets you
# exercise Host-header routing over plain HTTP at http://localhost:<port>.
#
#   *** THIS IS NOT REAL TLS. ***
# Let's Encrypt needs a public host answering on 80/443. For real HTTPS custom
# domains use a Linux host (a VPS) on 80/443, or a cloudflared tunnel.
#
# Idempotent: the container is fingerprinted with a config-hash label, so
# re-running with the same ports is a no-op (mirrors `switchyard up`).
#
# Usage:
#   bash scripts/local-ingress.sh up   [HTTP_PORT] [HTTPS_PORT]   # default 8080 8443
#   bash scripts/local-ingress.sh down
#
# Env:
#   TRAEFIK_IMAGE  traefik image to run (default traefik:v3.6.7). Do NOT pin
#                  v3.1.x: its docker/swarm providers speak Docker API 1.24,
#                  which engines >= 29 reject (MinAPIVersion 1.40) — providers
#                  fail with 'Error response from daemon: ""' and no
#                  label-based route ever loads.
#   BIND_ADDR      host address to publish on (default 127.0.0.1; keeps this
#                  login-less demo off the network, matching the CLI's model)

set -euo pipefail

CONTAINER="switchyard-traefik"
NETWORK="dokploy-network"
TRAEFIK_DIR="/etc/dokploy/traefik"          # lives inside the Docker VM on Desktop
HASH_LABEL="switchyard.config-hash"
TRAEFIK_IMAGE="${TRAEFIK_IMAGE:-traefik:v3.6.7}"
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"

log()  { printf '\033[0;34m[ingress]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m[ingress]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ingress]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[ingress]\033[0m %s\n' "$*" >&2; exit 1; }

# Fingerprint of everything that affects the container, portable across
# Linux/macOS (sha256sum, shasum, or cksum — whichever exists).
fingerprint() {
  local spec="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$spec" | sha256sum | cut -c1-16
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$spec" | shasum -a 256 | cut -c1-16
  else
    printf '%s' "$spec" | cksum | tr -d ' '
  fi
}

remove_container() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}

do_up() {
  local http="${1:-8080}" https="${2:-8443}"

  docker version >/dev/null 2>&1 || die "Docker is not available. Start Docker Desktop and retry."
  docker network inspect "$NETWORK" >/dev/null 2>&1 \
    || die "Network $NETWORK is missing — run \`switchyard up\` first."

  # Dokploy writes its Traefik static+dynamic config into $TRAEFIK_DIR; without
  # it there is nothing to serve. The path is inside the Docker VM on Desktop,
  # so probe it with a throwaway container rather than the host filesystem.
  if ! docker run --rm -v "$TRAEFIK_DIR:/mnt" alpine test -f /mnt/traefik.yml >/dev/null 2>&1; then
    die "No Traefik config at $TRAEFIK_DIR/traefik.yml yet.
Deploy an application in Dokploy first (that makes Dokploy generate the config),
then re-run this command."
  fi

  local spec="$TRAEFIK_IMAGE|$BIND_ADDR|$http|$https"
  local hash
  hash="$(fingerprint "$spec")"

  # Idempotent: same config + already running => nothing to do.
  local existing
  existing="$(docker inspect "$CONTAINER" \
    --format "{{ index .Config.Labels \"$HASH_LABEL\" }}|{{ .State.Running }}" 2>/dev/null || true)"
  if [ "$existing" = "$hash|true" ]; then
    ok "Local ingress already running on http://localhost:$http (unchanged)."
    return 0
  fi

  remove_container
  log "Starting $CONTAINER ($TRAEFIK_IMAGE) on $BIND_ADDR:$http (HTTP) / $BIND_ADDR:$https (HTTPS) ..."
  docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK" \
    -p "$BIND_ADDR:$http:80" \
    -p "$BIND_ADDR:$https:443" \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v "$TRAEFIK_DIR:$TRAEFIK_DIR" \
    -l "switchyard.managed=true" \
    -l "$HASH_LABEL=$hash" \
    "$TRAEFIK_IMAGE" \
    --configFile="$TRAEFIK_DIR/traefik.yml" >/dev/null \
    || die "Failed to start $CONTAINER (is host port $http or $https already in use?)."

  ok "Local ingress up. Point a domain at 127.0.0.1 (hosts file) and open http://<host>:$http"
  warn "HTTP only — this is NOT real TLS. Real HTTPS domains need a Linux host on 80/443 or a tunnel."
}

do_down() {
  log "Removing $CONTAINER ..."
  remove_container
  ok "Local ingress stopped."
}

case "${1:-}" in
  up)   shift; do_up "$@" ;;
  down) do_down ;;
  *)    die "Usage: bash scripts/local-ingress.sh up [HTTP_PORT] [HTTPS_PORT] | down" ;;
esac
