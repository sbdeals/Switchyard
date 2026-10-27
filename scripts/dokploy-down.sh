#!/usr/bin/env bash
# Tear down the Dokploy stack.
#   Usage: sudo scripts/dokploy-down.sh [--purge]
#   --purge also removes control-plane secrets/data and dokploy-network unless
#   deployed workloads still need that shared network.

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
  # Match core/network-workloads.ts: busy endpoints alone do not establish
  # workload ownership. Exact control-plane names/labels are the only exclusions.
  network_has_workloads() {
    local network_id containers services name service targets target
    network_id=$(docker network inspect dokploy-network --format '{{.Id}}') || return 2
    [ -n "$network_id" ] || return 2
    containers=$(docker ps --all --filter network=dokploy-network --format '{{.Names}}\t{{.Label "com.docker.swarm.service.name"}}') || return 2
    while IFS=$'\t' read -r name service; do
      [ -n "$name" ] || continue
      case "$name" in switchyard|switchyard-traefik|dokploy-traefik) continue ;; esac
      case "$service" in dokploy|dokploy-postgres|dokploy-redis|switchyard-metrics) continue ;; esac
      return 0
    done <<< "$containers"
    # Include attachments from workload services running on other Swarm nodes.
    services=$(docker service ls --format '{{.Name}}') || return 2
    for service in $services; do
      case "$service" in dokploy|dokploy-postgres|dokploy-redis|switchyard-metrics) continue ;; esac
      targets=$(docker service inspect "$service" --format '{{range .Spec.TaskTemplate.Networks}}{{println .Target}}{{end}}') || return 2
      for target in $targets; do
        [ "$target" != "$network_id" ] && [ "$target" != "dokploy-network" ] || return 0
      done
    done
    return 1
  }

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
      if [ "$kind:$name" = "network:dokploy-network" ] && network_has_workloads; then
        log "Keeping dokploy-network: it still has attached workloads."
        continue
      fi
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
