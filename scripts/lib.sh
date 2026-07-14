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
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null \
      | awk '$2 != "docker0" {print $4}' \
      | cut -d/ -f1 \
      | head -n1
    return 0
  fi
  # Minimal containers may lack iproute2. `hostname -I` lists all addresses;
  # skip 172.17.x.x (docker0's default subnet) to match the ip(8) path above.
  hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^172\.17\.' | grep . | head -n1
}

# Add the pull-through mirror to /etc/docker/daemon.json. Returns 10 when the
# file changed (caller should restart dockerd), 0 when no change was needed.
# Never clobbers an existing daemon.json: merges into it with jq, and if jq is
# unavailable on a host that already has a config, leaves it untouched.
ensure_registry_mirror() {
  if [ -f "$DOCKER_DAEMON_JSON" ] && grep -q "mirror.gcr.io" "$DOCKER_DAEMON_JSON" 2>/dev/null; then
    return 0
  fi
  log "Configuring Docker registry mirror ($REGISTRY_MIRROR) to avoid Docker Hub rate limits"
  mkdir -p "$(dirname "$DOCKER_DAEMON_JSON")"

  # No existing config: write a fresh minimal one.
  if [ ! -f "$DOCKER_DAEMON_JSON" ]; then
    cat > "$DOCKER_DAEMON_JSON" <<EOF
{
  "registry-mirrors": ["$REGISTRY_MIRROR"]
}
EOF
    return 10
  fi

  # Existing config: merge the mirror in without disturbing other settings.
  if command -v jq >/dev/null 2>&1; then
    local tmp
    tmp="$(mktemp)"
    if jq --arg m "$REGISTRY_MIRROR" \
         '.["registry-mirrors"] = (((.["registry-mirrors"] // []) + [$m]) | unique)' \
         "$DOCKER_DAEMON_JSON" > "$tmp" 2>/dev/null; then
      cat "$tmp" > "$DOCKER_DAEMON_JSON"   # preserve file mode/inode
      rm -f "$tmp"
      return 10
    fi
    rm -f "$tmp"
    warn "Could not parse $DOCKER_DAEMON_JSON as JSON; leaving it unchanged."
    return 0
  fi

  warn "jq not found and $DOCKER_DAEMON_JSON already exists; not modifying it."
  warn "If you hit Docker Hub rate limits, add \"registry-mirrors\": [\"$REGISTRY_MIRROR\"] manually."
  return 0
}

dockerd_running() {
  docker info >/dev/null 2>&1
}

# True only when systemd is actually running as init (not merely installed).
# /run/systemd/system exists iff systemd is the active init system — this host
# ships systemctl but runs a sandbox supervisor as PID 1, so it returns false.
has_systemd() {
  [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1
}

_wait_dockerd_up() {
  for _ in $(seq 1 30); do
    dockerd_running && { ok "Docker daemon is up"; return 0; }
    sleep 1
  done
  die "Docker daemon failed to start. See $DOCKERD_LOG (or 'journalctl -u docker')."
}

start_dockerd() {
  if dockerd_running; then return 0; fi
  log "Starting Docker daemon..."
  # Prefer systemd when it owns the daemon (the normal VPS case), so the daemon
  # stays under systemd and survives reboots. Fall back to launching dockerd
  # directly when there's no systemd (this sandbox) or no docker unit.
  if has_systemd; then
    systemctl start docker >/dev/null 2>&1 || true
  fi
  # Only launch a fresh dockerd when none exists. If a dockerd process is
  # already present but not yet answering, wait for it rather than spawning a
  # second daemon that would fight over /var/run/docker.sock.
  if ! dockerd_running && ! pgrep -x dockerd >/dev/null 2>&1; then
    nohup dockerd >"$DOCKERD_LOG" 2>&1 &
    disown || true
  fi
  _wait_dockerd_up
}

restart_dockerd() {
  log "Restarting Docker daemon to apply configuration..."
  if has_systemd && systemctl restart docker >/dev/null 2>&1; then
    _wait_dockerd_up
    return 0
  fi
  # Manual restart (no systemd, or docker isn't a systemd-managed unit).
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

# Wait for the Dokploy app to actually serve HTTP. The container healthcheck
# can report healthy while the app returns 500s (e.g. when its database
# credentials are wrong), so this is the real readiness signal. DOKPLOY_PORT
# overrides the host port to poll (default 3000) — used by the switchyard CLI
# when Dokploy is published on a non-default port.
wait_dokploy_http() {
  local tries="${1:-40}" port="${DOKPLOY_PORT:-3000}"
  for _ in $(seq 1 "$tries"); do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "http://localhost:${port}" 2>/dev/null || true)
    case "$code" in 2*|3*) return 0 ;; esac
    sleep 3
  done
  return 1
}

# Path to the Traefik static config Dokploy generates. Override with TRAEFIK_YML.
TRAEFIK_YML_PATH="${TRAEFIK_YML:-/etc/dokploy/traefik/traefik.yml}"

# Enable Traefik's Prometheus metrics in the Dokploy-owned traefik.yml so the
# dashboard's HTTP panels (traffic / requests / error rate / response time) have
# a data source. The dashboard scrapes TRAEFIK_METRICS_URL
# (default http://127.0.0.1:8081/metrics); enabling the block here is what makes
# the per-service `traefik_service_*` series appear.
#
# Idempotent: a no-op when the block already exists or the config hasn't been
# generated yet (fresh install, before the first deploy). traefik.yml is
# Dokploy-owned, so we only *append* the top-level `metrics:` key rather than
# rewrite the file. Returns 10 when it changed the file (caller restarts
# Traefik to apply the static config), 0 otherwise.
ensure_traefik_metrics() {
  local f="$TRAEFIK_YML_PATH"
  # Missing, or the bogus-directory case handled in dokploy-up.sh — skip quietly.
  [ -f "$f" ] || return 0
  if grep -q '^metrics:' "$f" 2>/dev/null; then
    return 0
  fi
  log "Enabling Traefik Prometheus metrics in $f (feeds the dashboard HTTP metrics)"
  # Top-level YAML key; append at column 0 with a leading newline so we don't
  # glue onto a file that lacks a trailing newline.
  printf '\nmetrics:\n  prometheus:\n    addEntryPointsLabels: true\n    addServicesLabels: true\n' >> "$f" \
    || { warn "Could not write $f; skipping metrics enablement."; return 0; }
  return 10
}

# Ensure metrics are enabled and restart Traefik to pick up the change. Runs on
# every `up`, so existing installs converge on the next launch. Exposing
# Traefik's internal :8080 on 127.0.0.1:8081 — the URL the dashboard scrapes via
# TRAEFIK_METRICS_URL (default http://127.0.0.1:8081/metrics) — is the ingress
# layer's responsibility (the local-ingress Traefik publishes 127.0.0.1:8081:8080);
# this step only turns the metrics ON in the static config.
converge_traefik_metrics() {
  local changed=0
  ensure_traefik_metrics || changed=$?
  if [ "$changed" = "10" ] && docker inspect dokploy-traefik >/dev/null 2>&1; then
    log "Restarting dokploy-traefik to apply the metrics config"
    docker restart dokploy-traefik >/dev/null 2>&1 \
      || warn "Could not restart dokploy-traefik — restart it manually to apply metrics."
  fi
}
