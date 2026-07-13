#!/usr/bin/env bash
# Print the host's advertise IP (the public/routable IPv4 Swarm binds to) on
# stdout, or nothing if none can be detected. The switchyard CLI captures this
# and hands it to the dashboard container as SWITCHYARD_HOST_IP, which lets app
# deploys mint an auto-URL (<app>.<ip>.sslip.io, or a Dokploy *.traefik.me host)
# with no manual DNS. Honors $ADVERTISE_ADDR. No root required — reads only.
#
# Usage:  bash scripts/host-ip.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

detect_advertise_addr
