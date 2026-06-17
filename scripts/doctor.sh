#!/usr/bin/env bash
# Check that the prerequisites for Dokploy and Claude Code are present.
#   Usage: scripts/doctor.sh

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pass() { printf '\033[0;32m  ok \033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m FAIL\033[0m %s\n' "$*"; }
info() { printf '\033[0;34m info\033[0m %s\n' "$*"; }

echo "== Claude Code =="
if command -v claude >/dev/null 2>&1; then pass "claude: $(claude --version 2>&1 | head -1)"; else fail "claude not installed (npm i -g @anthropic-ai/claude-code)"; fi
if command -v node >/dev/null 2>&1;   then pass "node: $(node --version)"; else fail "node not installed"; fi

echo "== Dokploy / Docker =="
if command -v docker >/dev/null 2>&1; then pass "docker: $(docker --version)"; else fail "docker not installed"; fi
if docker info >/dev/null 2>&1; then
  pass "docker daemon is running"
  if docker info 2>/dev/null | grep -q "mirror.gcr.io"; then pass "registry mirror configured"; else info "registry mirror not set (Docker Hub rate limits may apply)"; fi
  state=$(docker info 2>/dev/null | awk -F': ' '/Swarm:/{print $2}')
  info "swarm: ${state:-unknown}"
  if docker service inspect dokploy >/dev/null 2>&1; then pass "dokploy service deployed"; else info "dokploy not deployed yet (run: make up)"; fi
else
  info "docker daemon not running (run: make up)"
fi

echo "== Kernel quirks handled by these scripts =="
# Capture first to avoid pipefail being poisoned by zcat's non-zero exit on
# /proc/config.gz (it warns about trailing garbage).
ipvs_cfg="$(zcat /proc/config.gz 2>/dev/null | grep 'CONFIG_IP_VS' || true)"
if echo "$ipvs_cfg" | grep -q '=y'; then
  info "IP_VS present -> Swarm VIP routing works (dnsrr still safe)"
else
  info "IP_VS absent -> services use --endpoint-mode dnsrr (handled by these scripts)"
fi
