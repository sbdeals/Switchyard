#!/usr/bin/env bash
# Provision the Switchyard metrics store: a dedicated Postgres for durable
# metrics/logs persistence. Idempotent — safe to run repeatedly.
#
# The dashboard container reaches it by service DNS on dokploy-network, so this
# service MUST join that network and use --endpoint-mode dnsrr (this kernel has
# no IP_VS, so Swarm VIPs don't route — same constraint as the Dokploy stack).
#
# Usage:  export SWITCHYARD_METRICS_PASSWORD first, then:
#         sudo --preserve-env=SWITCHYARD_METRICS_PASSWORD bash scripts/switchyard-store-up.sh
# Env:    SWITCHYARD_METRICS_PASSWORD  required — Postgres superuser password
#         SWITCHYARD_STORE_IMAGE       Postgres image (default postgres:16)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

STORE_SERVICE="switchyard-metrics"
STORE_VOLUME="switchyard-metrics"
STORE_IMAGE="${SWITCHYARD_STORE_IMAGE:-postgres:16}"

require_root
ensure_docker

[ -n "${SWITCHYARD_METRICS_PASSWORD:-}" ] \
  || die "SWITCHYARD_METRICS_PASSWORD is required (the switchyard CLI passes it)."

docker network inspect dokploy-network >/dev/null 2>&1 \
  || die "dokploy-network does not exist — run scripts/dokploy-up.sh first."

if service_exists "$STORE_SERVICE"; then
  ok "Metrics store ($STORE_SERVICE) is already deployed."
  exit 0
fi

log "Creating the metrics store service ($STORE_SERVICE, --endpoint-mode dnsrr)..."
# Env-file name-only entries are resolved from the Docker client's environment.
# Unlike a literal KEY=value line, this also preserves newlines in the password.
STORE_ENV_FILE="$(mktemp)"
trap 'rm -f -- "$STORE_ENV_FILE"' EXIT
printf '%s\n' POSTGRES_PASSWORD > "$STORE_ENV_FILE"
POSTGRES_PASSWORD="$SWITCHYARD_METRICS_PASSWORD" docker service create --detach \
  --name "$STORE_SERVICE" \
  --network dokploy-network \
  --endpoint-mode dnsrr \
  --constraint 'node.role==manager' \
  --env POSTGRES_USER=switchyard \
  --env POSTGRES_DB=switchyard \
  --env-file "$STORE_ENV_FILE" \
  --mount "type=volume,source=${STORE_VOLUME},target=/var/lib/postgresql/data" \
  "$STORE_IMAGE"
rm -f -- "$STORE_ENV_FILE"
trap - EXIT

log "Waiting for the metrics store to converge..."
if wait_service_converged "$STORE_SERVICE" 60; then
  ok "Metrics store is up."
else
  warn "Metrics store did not converge yet; check 'docker service ps $STORE_SERVICE --no-trunc'."
fi
