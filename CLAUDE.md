# Project context for Claude Code

Goal: an open-source, Railway-style PaaS built on top of **Dokploy**, driven by
**Claude Code**. This repo currently contains the launch tooling; the dashboard
is the next milestone.

## Launching things

- `make up` / `scripts/dokploy-up.sh` — launch the Dokploy stack (idempotent).
- `make status` — stack status + dashboard URL (http://localhost:3000).
- `make down` — stop the stack (`PURGE=1` to also remove volumes/secrets).
- `make claude` — launch Claude Code in this repo.
- `make doctor` — verify prerequisites.

## This host's quirks (already handled by the scripts — don't re-debug from scratch)

- **No systemd** (PID 1 is a sandbox supervisor). Start Docker with `dockerd`
  directly, not `systemctl`. `scripts/lib.sh:start_dockerd` does this.
- **Docker Hub rate limits** on the shared egress IP. A pull-through mirror
  (`https://mirror.gcr.io`) is configured in `/etc/docker/daemon.json`.
- **No IPVS** (`CONFIG_IP_VS is not set`), so Swarm service VIPs don't route.
  All services use `--endpoint-mode dnsrr`. If you add new Swarm services that
  others connect to by name, give them dnsrr too or connections will hang.
- The environment is **ephemeral**: a fresh container = a fresh install. Commit
  anything worth keeping. Dokploy data lives in Docker volumes that do not
  survive a new container.

## Conventions

- Shell scripts: `bash`, `set -euo pipefail`, shared helpers in `scripts/lib.sh`.
- Keep `make up` idempotent — safe to run when the stack is already up.
