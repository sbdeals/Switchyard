# Project context for Claude Code

This project is **Switchyard** (its official name): an open-source,
Railway-style PaaS built on top of **Dokploy**, driven by **Claude Code**.
Five parts live here: the bash launch tooling (`scripts/`), the Switchyard
dashboard (`dashboard/`), the `switchyard` CLI (`cli/`, npm package
**`switchyard-cli`**) that turns everything into a one-command install, the
desktop app (`desktop/`, Electron) that turns it into a one-click install,
and the MCP server (`mcp/`, registered in `.mcp.json`) that exposes Dokploy
operations as tools to Claude Code.

## Launching things

- `npx switchyard-cli up` — one-command install/converge of the whole stack:
  Dokploy + terminal-guided admin registration + the dashboard as a managed
  container. `install.sh` (repo root) is the curl-able Linux bootstrap that
  ends in the same command.
- `make up` / `scripts/dokploy-up.sh` — launch the Dokploy stack (idempotent).
- `make status` — stack status + dashboard URL (http://localhost:3000).
- `make down` — stop the stack (`PURGE=1` to also remove volumes/secrets).
- `make claude` — launch Claude Code in this repo.
- `make doctor` — verify prerequisites.

## The CLI (`cli/`)

- **npm naming landmine:** the bare npm name `switchyard` is an unrelated
  abandoned package. Ours is **`switchyard-cli`** (bin name `switchyard`).
  Never write `npx switchyard` in docs or code.
- On Linux the CLI shells out to the repo's `scripts/*.sh` — change behavior
  in the scripts, don't duplicate it in TypeScript. `cli/copy-scripts.mjs`
  copies `scripts/` into the package at publish time (`prepack`).
- On Windows/macOS it replays docs/getting-started.md Path B programmatically
  (`cli/src/platform/docker-desktop.ts`) — keep that doc and module in sync.
- `switchyard up` must stay **idempotent**, like `make up`. The dashboard
  container is fingerprinted with a config-hash label; same config → no-op.
- The dashboard image is `ghcr.io/sbdeals/switchyard`, built from
  `dashboard/Dockerfile` (Next standalone output). Releasing: tag `vX.Y.Z`
  (must equal `cli/package.json` version) → `.github/workflows/release.yml`
  pushes the image then npm-publishes (needs the `NPM_TOKEN` repo secret).
- The dashboard requires a **per-user Dokploy login** (`/login`; gate lives in
  `dashboard/src/proxy.ts`). A login gate is not TLS, so the CLI still binds it
  to 127.0.0.1 by default; keep any new exposure path behind explicit
  `--expose`-style confirmation.

## The desktop app (`desktop/`)

- Electron shell around the SAME converge logic: it imports `cli/src/core/*`
  and `cli/src/platform/docker-desktop.ts` directly (never `platform/index.ts`
  or `linux.ts` — they use `import.meta`, and the desktop bundle is CJS).
  Change provisioning behavior in the cli modules, not in `desktop/`.
- `desktop/src/main/orchestrator.ts` mirrors `cli/src/commands/up.ts` with
  prompts replaced by wizard/credential views — keep the two flows in sync.
- Auto-login mints the dashboard session cookie in
  `desktop/src/main/autologin.ts`, an exact mirror of
  `dashboard/src/lib/session.ts#sealSession` — changing that format breaks it.
- Releases: the tag must match `desktop/package.json` too; installers +
  electron-updater feed publish from `.github/workflows/release.yml`.
- Verify changes with `npm run smoke` in `desktop/` (headless converge +
  auto-login proof; exit 0 = pass).

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
