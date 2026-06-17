#!/usr/bin/env bash
# Shared helpers for the Dokploy + Claude Code launch scripts.
#
# This environment has two quirks that the upstream Dokploy installer does not
# handle on its own. Both are worked around here so the stack comes up cleanly:
#
#   1. Docker Hub anonymous pull-rate limit (shared cloud egress IP). We point
#      dockerd at Google's pull-through mirror (mirror.gcr.io) via daemon.json.
#   2. The kernel is built without IP_VS (CONFIG_IP_VS is not set), so Swarm's
#      default VIP load-balancing cannot route traffic between services. We run
#      every Dokploy service in DNS round-robin mode (--endpoint-mode dnsrr),
#      which resolves service names straight to task IPs and bypasses IPVS.

set -euo pipefail

DOCKER_DAEMON_JSON="/etc/docker/daemon.json"
REGISTRY_MIRROR="https://mirror.gcr.io"
DOCKERD_LOG="/var/log/dockerd.log"

log()  { printf '\033[0;34m[dokploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m[dokploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[dokploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[dokploy]\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" = "0" ] || die "This script must be run as root."
}

# Pick the advertise address for Docker Swarm: the first global IPv4 that is
# not the loopback or the docker0 bridge.
detect_advertise_addr() {
  if [ -n "${ADVERTISE_ADDR:-}" ]; then
    echo "$ADVERTISE_ADDR"; return 0
  fi
  ip -4 -o addr show scope global 2>/dev/null \
    | awk '$2 != "docker0" {print $4}' \
    | cut -d/ -f1 \
    | head -n1
}

ensure_registry_mirror() {
  if [ -f "$DOCKER_DAEMON_JSON" ] && grep -q "mirror.gcr.io" "$DOCKER_DAEMON_JSON"; then
    return 0
  fi
  log "Configuring Docker registry mirror ($REGISTRY_MIRROR) to avoid Docker Hub rate limits"
  mkdir -p "$(dirname "$DOCKER_DAEMON_JSON")"
  cat > "$DOCKER_DAEMON_JSON" <<EOF
{
  "registry-mirrors": ["$REGISTRY_MIRROR"]
}
EOF
  return 10  # signal: daemon.json changed, caller should (re)start dockerd
}

dockerd_running() {
  docker info >/dev/null 2>&1
}

start_dockerd() {
  if dockerd_running; then return 0; fi
  log "Starting Docker daemon..."
  nohup dockerd >"$DOCKERD_LOG" 2>&1 &
  disown || true
  for _ in $(seq 1 30); do
    dockerd_running && { ok "Docker daemon is up"; return 0; }
    sleep 1
  done
  die "Docker daemon failed to start. See $DOCKERD_LOG"
}

restart_dockerd() {
  log "Restarting Docker daemon to apply configuration..."
  pkill -x dockerd 2>/dev/null || true
  for _ in $(seq 1 15); do dockerd_running || break; sleep 1; done
  start_dockerd
}

# Ensure dockerd is running with the registry mirror applied.
ensure_docker() {
  local changed=0
  ensure_registry_mirror || changed=$?
  if dockerd_running; then
    if [ "$changed" = "10" ]; then restart_dockerd; fi
  else
    start_dockerd
  fi
}

service_exists() {
  docker service inspect "$1" >/dev/null 2>&1
}

# Wait for a Swarm service to reach its desired replica count.
wait_service_converged() {
  local name="$1" tries="${2:-60}"
  for _ in $(seq 1 "$tries"); do
    local rep
    rep=$(docker service ls --filter "name=$name" --format '{{.Replicas}}' 2>/dev/null | head -1)
    case "$rep" in
      1/1|2/2) return 0 ;;
    esac
    sleep 2
  done
  return 1
}

# Wait for the dokploy app container's healthcheck to pass.
wait_dokploy_healthy() {
  local tries="${1:-60}"
  for _ in $(seq 1 "$tries"); do
    local cid status
    cid=$(docker ps -q --filter "name=dokploy.1." | head -1)
    if [ -n "$cid" ]; then
      status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "")
      [ "$status" = "healthy" ] && return 0
    fi
    sleep 3
  done
  return 1
}
