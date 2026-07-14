#!/bin/sh
# Switchyard bootstrap — one command from a fresh Linux host to a running
# Dokploy + Switchyard stack:
#
#   curl -fsSL https://raw.githubusercontent.com/sbdeals/switchyard/main/install.sh | bash
#
# Installs Docker and Node.js if missing, then hands off to the switchyard
# CLI (npm: switchyard-cli), which does the real work. Extra flags go to
# `switchyard up`:
#
#   curl -fsSL .../install.sh | bash -s -- --headless --email you@example.com --password s3cret
#
# Windows/macOS: skip this script — install Docker Desktop + Node 20+, then
# run `npx switchyard-cli up`.
#
# POSIX sh. Everything happens inside main() so a truncated download can't
# half-execute.
set -eu

log()  { printf '\033[1;34m[switchyard]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[switchyard]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[switchyard]\033[0m %s\n' "$*" >&2; exit 1; }

# Run a command as root (directly or via sudo).
run_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  major=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
  [ "${major:-0}" -ge 20 ]
}

install_docker() {
  log "Installing Docker (get.docker.com) ..."
  run_root sh -c 'curl -fsSL https://get.docker.com | sh'
  # Start it where systemd exists; hosts without systemd are handled later by
  # the launch scripts themselves (scripts/lib.sh:start_dockerd).
  run_root systemctl enable --now docker 2>/dev/null || true
}

install_node() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Installing Node.js 22 (NodeSource, apt) ..."
    run_root sh -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs'
  elif command -v dnf >/dev/null 2>&1; then
    log "Installing Node.js 22 (NodeSource, dnf) ..."
    run_root sh -c 'curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && dnf install -y nodejs'
  elif command -v yum >/dev/null 2>&1; then
    log "Installing Node.js 22 (NodeSource, yum) ..."
    run_root sh -c 'curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && yum install -y nodejs'
  else
    log "No apt/dnf/yum — installing the official Node.js 22 tarball into /usr/local ..."
    arch=$(uname -m)
    case "$arch" in
      x86_64) narch=x64 ;;
      aarch64 | arm64) narch=arm64 ;;
      *) fail "Unsupported architecture for the tarball fallback: $arch" ;;
    esac
    base="https://nodejs.org/dist/latest-v22.x"
    file=$(curl -fsSL "$base/" | grep -o "node-v[0-9.]*-linux-$narch\.tar\.gz" | head -1)
    [ -n "$file" ] || fail "Could not resolve the latest Node.js 22 tarball for $narch."
    run_root sh -c "curl -fsSL '$base/$file' | tar -xz -C /usr/local --strip-components=1"
  fi
  node_ok || fail "Node.js installation did not produce node >= 20 on PATH."
}

main() {
  [ "$(uname -s)" = "Linux" ] || fail "This bootstrap is Linux-only. On Windows/macOS: install Docker Desktop + Node 20+, then run: npx switchyard-cli up"
  command -v curl >/dev/null 2>&1 || fail "curl is required."
  if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
    fail "Run as root, or install sudo."
  fi

  if command -v docker >/dev/null 2>&1; then
    log "Docker already installed: $(docker --version 2>/dev/null || echo present)"
  else
    install_docker
  fi

  if node_ok; then
    log "Node.js already installed: $(node --version)"
  else
    install_node
  fi

  log "Handing off to the switchyard CLI ..."
  # The CLI needs root on Linux (dockerd, /etc/switchyard). `sudo env PATH=`
  # survives secure_path when Node lives in /usr/local. Under `curl | bash`
  # stdin is the pipe; re-attach the terminal so the CLI can prompt (admin
  # email/password). No terminal -> headless.
  if [ -r /dev/tty ] && [ -t 1 ]; then
    if [ "$(id -u)" -eq 0 ]; then
      exec npx --yes switchyard-cli@latest up "$@" </dev/tty
    fi
    exec sudo env "PATH=$PATH" npx --yes switchyard-cli@latest up "$@" </dev/tty
  else
    warn "No terminal detected — running headless (credentials will be generated and stored in /etc/switchyard/config.json)."
    if [ "$(id -u)" -eq 0 ]; then
      exec npx --yes switchyard-cli@latest up --headless "$@"
    fi
    exec sudo env "PATH=$PATH" npx --yes switchyard-cli@latest up --headless "$@"
  fi
}

main "$@"
