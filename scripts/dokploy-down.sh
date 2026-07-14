#!/usr/bin/env bash
# Tear down the Dokploy stack.
#   Usage: sudo scripts/dokploy-down.sh [--purge]
#   --purge also removes the dokploy-network, secrets, and data volumes.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

require_root
dockerd_running || die "Docker daemon is not running."

PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

log "Removing Dokploy services and Traefik..."
docker service rm dokploy dokploy-postgres dokploy-redis 2>/dev/null || true
docker rm -f dokploy-traefik 2>/dev/null || true

# The Switchyard metrics store (its data volume survives unless --purge).
log "Removing the Switchyard metrics store..."
docker service rm switchyard-metrics 2>/dev/null || true

if [ "$PURGE" = "1" ]; then
  warn "Purging network, secrets, and data volumes..."
  docker network rm dokploy-network 2>/dev/null || true
  docker secret rm dokploy_postgres_password dokploy_auth_secret 2>/dev/null || true
  docker volume rm dokploy dokploy-postgres dokploy-redis switchyard-metrics 2>/dev/null || true
fi

ok "Dokploy stack stopped."
