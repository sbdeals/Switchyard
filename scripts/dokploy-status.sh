#!/usr/bin/env bash
# Show the status of the Dokploy stack and how to reach the dashboard.
#   Usage: sudo scripts/dokploy-status.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

if ! dockerd_running; then
  warn "Docker daemon is not running. Run: sudo scripts/dokploy-up.sh"
  exit 1
fi

echo
log "Swarm services:"
docker service ls 2>/dev/null || true
echo
log "Dokploy-related containers:"
docker ps --filter "name=dokploy" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
echo

addr="$(detect_advertise_addr)"
cid=$(docker ps -q --filter "name=dokploy.1." | head -1)
health="unknown"
if [ -n "$cid" ]; then
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}' "$cid" 2>/dev/null || echo unknown)
fi

if [ "$health" = "healthy" ]; then
  ok  "Dokploy is healthy."
else
  warn "Dokploy health: $health"
fi
port="${DOKPLOY_PORT:-3000}"
log "Dashboard: http://${addr:-<server-ip>}:${port}  (also http://localhost:${port} on this host)"
