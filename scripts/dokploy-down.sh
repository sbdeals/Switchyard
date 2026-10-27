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
  # Swarm removes services asynchronously; their containers may still hold data.
  tasks_drained() {
    local services containers service
    services=$(docker service ls --format '{{.Name}}' 2>/dev/null) || return 1
    for service in $services; do
      case "$service" in
        dokploy|dokploy-postgres|dokploy-redis|switchyard-metrics) return 1 ;;
      esac
    done
    for service in dokploy dokploy-postgres dokploy-redis switchyard-metrics; do
      containers=$(docker ps -a -q --filter "label=com.docker.swarm.service.name=$service" 2>/dev/null) || return 1
      [ -z "$containers" ] || return 1
    done
    return 0
  }

  log "Waiting for Swarm tasks to drain (up to 60 seconds)..."
  for _ in $(seq 1 30); do
    tasks_drained && break
    sleep 2
  done

  remove_resource() {
    local kind="$1" name="$2" attempt output
    for attempt in $(seq 1 10); do
      if output=$(docker "$kind" rm "$name" 2>&1); then return 0; fi
      case "$output" in
        *"in use"*|*"active endpoints"*)
          [ "$attempt" = "10" ] || { sleep 2; continue; }
          ;;
      esac
      # Absence is success. The final inventory also catches other failures.
      return 0
    done
  }

  warn "Purging network, secrets, and data volumes..."
  remove_resource network dokploy-network
  for name in dokploy_postgres_password dokploy_auth_secret; do
    remove_resource secret "$name"
  done
  for name in dokploy dokploy-postgres dokploy-redis switchyard-metrics; do
    remove_resource volume "$name"
  done

  failed=0
  for kind in network secret volume; do
    if ! resources=$(docker "$kind" ls --format '{{.Name}}' 2>&1); then
      warn "Could not verify $kind removal: $resources"
      failed=1
      continue
    fi
    for name in $resources; do
      case "$kind:$name" in
        network:dokploy-network|secret:dokploy_postgres_password|secret:dokploy_auth_secret|\
        volume:dokploy|volume:dokploy-postgres|volume:dokploy-redis|volume:switchyard-metrics)
          warn "Still present: $kind $name"
          failed=1
          ;;
      esac
    done
  done
  [ "$failed" = "0" ] || die "Purge incomplete. Release resources still in use, then retry with --purge."
fi

ok "Dokploy stack stopped."
