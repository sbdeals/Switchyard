#!/usr/bin/env bash
# Launch Dokploy on this machine. Idempotent: safe to run repeatedly.
#
# - Brings up the Docker daemon (with the Docker Hub mirror) if it isn't running.
# - If Dokploy is already deployed, just reports status and exits.
# - Otherwise runs the official Dokploy installer, forcing DNS round-robin
#   endpoint mode (this kernel lacks IP_VS, so Swarm VIP routing does not work).
#
# Usage:  sudo scripts/dokploy-up.sh
# Env:    ADVERTISE_ADDR   override the Swarm advertise IP (auto-detected by default)
#         DOKPLOY_VERSION  pin a Dokploy version (defaults to latest stable)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

require_root
ensure_docker

if service_exists dokploy; then
  ok "Dokploy is already deployed."
  exec "$SCRIPT_DIR/dokploy-status.sh"
fi

ADVERTISE_ADDR="$(detect_advertise_addr)"
[ -n "$ADVERTISE_ADDR" ] || die "Could not detect an advertise address; set ADVERTISE_ADDR."
log "Using Swarm advertise address: $ADVERTISE_ADDR"

log "Running the official Dokploy installer (forcing --endpoint-mode dnsrr)..."
# The upstream installer only switches to dnsrr when it detects a Proxmox LXC
# container. We set container=lxc so that code path is taken on this IPVS-less
# kernel. The registry mirror is already applied at the daemon level.
tmp="$(mktemp)"
curl -fsSL https://dokploy.com/install.sh -o "$tmp"
ADVERTISE_ADDR="$ADVERTISE_ADDR" \
DOKPLOY_VERSION="${DOKPLOY_VERSION:-}" \
container=lxc \
  bash "$tmp"
rm -f "$tmp"

log "Waiting for the Dokploy app to become healthy..."
if wait_dokploy_healthy 80; then
  ok "Dokploy is healthy."
else
  warn "Dokploy did not report healthy yet; check 'scripts/dokploy-status.sh'."
fi

exec "$SCRIPT_DIR/dokploy-status.sh"
