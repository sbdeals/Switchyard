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
#         DOKPLOY_VERSION  pin a Dokploy version (defaults to "latest")
#         FORCE=1          reinstall even when leftover Dokploy data volumes exist

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

# Re-install trap: the installer runs `docker swarm leave --force`, which wipes
# the Swarm *secrets* (including the generated postgres password) while Docker
# *volumes* survive. A leftover dokploy-postgres volume then holds a password
# that no longer matches, and Dokploy crash-loops on DB auth. Refuse to walk
# into that unless the caller explicitly opts in.
if [ "${FORCE:-0}" != "1" ] && docker volume inspect dokploy-postgres >/dev/null 2>&1; then
  die "Found a dokploy-postgres volume from a previous install. Its password will not
match the fresh install's secrets. Either wipe the old data first
(scripts/dokploy-down.sh --purge) or re-run with FORCE=1 to install anyway."
fi

# Cleanup trap: if a previous install created the Traefik container before the
# Dokploy app wrote its config, Docker turned the traefik.yml bind-mount source
# into a *directory*, which crash-loops Traefik forever. Clear it so the app
# can write the real file.
if [ -d /etc/dokploy/traefik/traefik.yml ]; then
  warn "Removing bogus /etc/dokploy/traefik/traefik.yml directory left by a failed install."
  rm -rf /etc/dokploy/traefik/traefik.yml
fi

log "Running the official Dokploy installer (forcing --endpoint-mode dnsrr)..."
# The upstream installer only switches to dnsrr when it detects a Proxmox LXC
# container. We set container=lxc so that code path is taken on this IPVS-less
# kernel. The registry mirror is already applied at the daemon level.
#
# DOKPLOY_VERSION defaults to "latest": the installer's own version detection
# follows a github.com redirect, and behind proxies that block it the "version"
# silently becomes a URL, producing an invalid image tag.
tmp="$(mktemp)"
curl -fsSL https://dokploy.com/install.sh -o "$tmp"
ADVERTISE_ADDR="$ADVERTISE_ADDR" \
DOKPLOY_VERSION="${DOKPLOY_VERSION:-latest}" \
container=lxc \
  bash "$tmp"
rm -f "$tmp"

# The installer prints "Congratulations" even when service creation failed, so
# verify the service actually exists before waiting on its health.
service_exists dokploy \
  || die "The installer finished but the 'dokploy' service was not created. Check the installer output above."

log "Waiting for the Dokploy app to become healthy..."
if wait_dokploy_healthy 80 && wait_dokploy_http 40; then
  ok "Dokploy is healthy and serving HTTP."
else
  warn "Dokploy is not serving HTTP yet; check 'scripts/dokploy-status.sh' and the service logs."
fi

exec "$SCRIPT_DIR/dokploy-status.sh"
