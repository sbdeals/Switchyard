# Launch tooling

This is the reference for the root [`Makefile`](../Makefile) and the [`scripts/`](../scripts/) directory that install and manage the **Dokploy** stack — for operators bringing the stack up and down, and for contributors modifying the scripts. The scripts target a **Linux host**: they must run as root, they manage `dockerd` directly, and they assume Linux paths like `/etc/docker/daemon.json`. They do **not** run natively on Windows — for the Windows 11 / Docker Desktop path, see [Getting started](getting-started.md). How the Switchyard dashboard itself works is covered in [Architecture](architecture.md); failure diagnosis lives in [Troubleshooting](troubleshooting.md).

## Make targets

`SHELL := /bin/bash`; a bare `make` runs `help`, which prints the target list from the Makefile's own header comment.

| Target | Runs | What it does |
|---|---|---|
| `make help` | — | Print the target list (default target) |
| `make up` | `sudo bash scripts/dokploy-up.sh` | Launch the whole stack: dockerd, Swarm, Dokploy services, Traefik. Idempotent. |
| `make status` | `sudo bash scripts/dokploy-status.sh` | Stack status + the dashboard URL |
| `make down` | `sudo bash scripts/dokploy-down.sh` | Stop the stack, keep data |
| `make down PURGE=1` | `sudo bash scripts/dokploy-down.sh --purge` | Stop the stack **and** wipe network, secrets, and data volumes |
| `make claude` | `bash scripts/claude-up.sh` | Launch Claude Code in this repo (no root) |
| `make doctor` | `bash scripts/doctor.sh` | Check prerequisites for both tools (no root) |

## Shared helpers: `scripts/lib.sh`

Every launch script sources [`lib.sh`](../scripts/lib.sh) (`set -euo pipefail`, colored `log`/`ok`/`warn`/`die`, `require_root`). It encodes the two host quirks the stock Dokploy installer does not handle, plus the plumbing around them.

### Starting dockerd without systemd

On this sandbox host, PID 1 is a supervisor, not systemd — `systemctl start docker` cannot work. `has_systemd` returns true only when systemd is *actually the running init* (`/run/systemd/system` exists **and** `systemctl` is on PATH); merely having systemctl installed doesn't count. `start_dockerd` then:

1. no-ops if `docker info` already succeeds;
2. tries `systemctl start docker` when systemd really owns the daemon (the normal VPS case, so the daemon survives reboots);
3. otherwise launches `dockerd` directly with `nohup`, logging to `/var/log/dockerd.log` — but only if no `dockerd` process exists yet (`pgrep -x dockerd`), so it never spawns a second daemon to fight over `/var/run/docker.sock`;
4. waits up to 30 s for `docker info` to answer, or dies pointing at the log.

`restart_dockerd` mirrors this: `systemctl restart` when possible, else `pkill -x dockerd`, wait for it to stop, and `start_dockerd` again.

### Docker Hub mirror configuration

The shared cloud egress IP hits Docker Hub's anonymous pull-rate limit, so `ensure_registry_mirror` configures a pull-through mirror (`https://mirror.gcr.io`) in `/etc/docker/daemon.json`:

- already configured → return `0`, nothing to do;
- no `daemon.json` → write a minimal one with just `registry-mirrors`, return `10`;
- existing `daemon.json` → **merge** the mirror in with `jq` (preserving every other setting, deduplicating, keeping the file's inode/mode), return `10`;
- existing file but no `jq` (or unparseable JSON) → warn and leave the file untouched rather than clobbering it.

The return code is a protocol: `10` means "config changed, restart dockerd". `ensure_docker` ties it together — apply the mirror, then start dockerd (or restart it if it was already running and the config changed).

### Advertise address detection

Docker Swarm needs an `--advertise-addr`. `detect_advertise_addr` picks the first global IPv4 that isn't loopback or the `docker0` bridge, via `ip -4 -o addr show scope global`. Minimal containers may lack `iproute2`, so it falls back to `hostname -I`, skipping `172.17.x.x` (docker0's default subnet) to match the `ip(8)` path. An `ADVERTISE_ADDR` env var overrides both.

### Health waits

- `service_exists NAME` — `docker service inspect` as an existence check; this is how `dokploy-up.sh` detects an existing install.
- `wait_service_converged NAME [tries]` — polls `docker service ls` until replicas read `1/1` (or `2/2`), 2 s apart, default 60 tries.
- `wait_dokploy_healthy [tries]` — polls the `dokploy.1.*` task container's Docker **healthcheck** until it reports `healthy`, 3 s apart.
- `wait_dokploy_http [tries]` — polls `http://localhost:3000` with `curl` until a 2xx/3xx. This is the *real* readiness signal: the container healthcheck can report healthy while the app answers 500s (e.g. when its database credentials are wrong).

## `dokploy-up.sh` — launch the stack

```bash
sudo scripts/dokploy-up.sh
# Env: ADVERTISE_ADDR=…    override the Swarm advertise IP (auto-detected)
#      DOKPLOY_VERSION=…   pin a Dokploy version (default "latest")
#      FORCE=1             install even when leftover Dokploy data volumes exist
```

The flow, in order:

1. `require_root`, `ensure_docker` (mirror + dockerd as above).
2. **Idempotency short-circuit**: if the `dokploy` Swarm service already exists, print "already deployed" and `exec` into `dokploy-status.sh`. `make up` is therefore always safe to re-run.
3. Detect the advertise address (die if none can be found).
4. **Failure trap 1 — stale `dokploy-postgres` volume.** The upstream installer runs `docker swarm leave --force`, which wipes the Swarm *secrets* — including the generated Postgres password — while Docker *volumes* survive. A leftover `dokploy-postgres` volume then holds data initialized with a password that no longer matches the fresh install's secret, and Dokploy crash-loops on DB auth. The script **refuses to install** when it finds that volume, unless you either wipe first (`scripts/dokploy-down.sh --purge`) or explicitly opt in with `FORCE=1`.
5. **Failure trap 2 — `traefik.yml` created as a directory.** If a previous install started the Traefik container before the Dokploy app wrote its config file, Docker turned the `traefik.yml` bind-mount *source* into a directory, and Traefik crash-loops forever. The script deletes a bogus `/etc/dokploy/traefik/traefik.yml` directory so the app can write the real file.
6. Download and run the **official installer** (`https://dokploy.com/install.sh`) with three tweaks:
   - `ADVERTISE_ADDR` from step 3;
   - `DOKPLOY_VERSION` defaulting to `latest` — the installer's own version detection follows a `github.com` redirect, and behind proxies that block it the "version" silently becomes a URL, producing an invalid image tag;
   - `container=lxc` — see the next section.
7. **Verify** the `dokploy` service actually exists — the installer prints "Congratulations" even when service creation failed.
8. Wait for the container healthcheck (up to 80 tries) and then for real HTTP on `:3000` (up to 40 tries); warn (not die) if it isn't serving yet, then `exec` into `dokploy-status.sh`.

## Why every Swarm service uses `--endpoint-mode dnsrr`

This host's kernel is built **without IPVS** (`CONFIG_IP_VS is not set`). Docker Swarm's default endpoint mode gives every service a virtual IP whose load balancing is implemented with IPVS — so on this kernel, service names resolve fine but connections to the VIP silently hang (e.g. Dokploy → Postgres). DNS round-robin mode (`--endpoint-mode dnsrr`) sidesteps IPVS entirely by resolving service names straight to task IPs.

The trick used to get it: the upstream installer already contains a dnsrr code path, but only takes it when it detects a **Proxmox LXC container**. `dokploy-up.sh` exports `container=lxc` so the installer takes that path on this IPVS-less kernel — no fork of the installer needed.

Consequence for anything you add later (from [`CLAUDE.md`](../CLAUDE.md)): **any new Swarm service that other services connect to by name must also be created with `--endpoint-mode dnsrr`**, or connections to it will hang.

## `dokploy-status.sh` — stack status

```bash
sudo scripts/dokploy-status.sh
```

Exits 1 with a hint if dockerd isn't running. Otherwise prints: `docker service ls`, the Dokploy-related containers (`name/status/ports` table), the health of the `dokploy.1.*` task container (from its Docker healthcheck), and the dashboard URL built from the detected advertise address (`http://<addr>:3000`, also reachable as `http://localhost:3000` on the host).

## `dokploy-down.sh` — down vs `--purge`

```bash
sudo scripts/dokploy-down.sh          # stop the stack, keep data
sudo scripts/dokploy-down.sh --purge  # stop AND wipe data
```

| | Plain `down` | `down --purge` |
|---|---|---|
| Swarm services `dokploy`, `dokploy-postgres`, `dokploy-redis` | removed | removed |
| `dokploy-traefik` container | removed | removed |
| `dokploy-network` overlay | kept | removed |
| Secrets `dokploy_postgres_password`, `dokploy_auth_secret` | kept | removed |
| Volumes `dokploy`, `dokploy-postgres`, `dokploy-redis` | kept | removed |

Every removal tolerates already-missing resources (`|| true`), so `down` is idempotent too.

Note the interaction with `up`: after a plain `down`, the `dokploy-postgres` volume still exists, so the next `make up` hits failure trap 1 above and refuses to reinstall. For a clean slate use `--purge` (or `make down PURGE=1`); use `FORCE=1` only when you understand you're reinstalling on top of existing data. On this **ephemeral** sandbox host, remember that Dokploy's state lives in those Docker volumes — a fresh container means a fresh install regardless.

## `doctor.sh` — prerequisite checks

```bash
scripts/doctor.sh    # or: make doctor
```

Read-only diagnostics in four groups, printed as `ok` / `FAIL` / `info`:

- **Claude Code**: `claude` CLI on PATH (with version), `node`.
- **Host commands the scripts rely on**: `curl` (**FAIL** if missing — required to fetch the installer), `ip` (info — falls back to `hostname -I`), `jq` (info — without it an existing `daemon.json` can't be merged).
- **Dokploy / Docker**: `docker` binary, daemon running, registry mirror configured, Swarm state, whether the `dokploy` service is deployed.
- **Kernel quirks**: reads `/proc/config.gz` for `CONFIG_IP_VS` and reports whether Swarm VIP routing would work — either way, the scripts' dnsrr handling keeps things safe.

It diagnoses; it never changes anything.

## `claude-up.sh` — launch Claude Code

```bash
scripts/claude-up.sh [extra claude args…]    # or: make claude
```

Verifies the `claude` CLI is on PATH (with an install hint if not), prints its version, `cd`s to the repo root, and `exec`s `claude` with any pass-through arguments. Claude Code is the agent that drives this project; [`CLAUDE.md`](../CLAUDE.md) gives it the project context, including the host quirks documented above.

## Idempotency guarantees

`make up` is required to be safe to run at any time (see [`CLAUDE.md`](../CLAUDE.md)); the guarantees stack up like this:

- `dokploy-up.sh` short-circuits to a status report when the `dokploy` service already exists — the installer is never re-run over a live stack.
- `ensure_registry_mirror` is a no-op when the mirror is already configured, and merges rather than overwrites an existing `daemon.json`.
- `start_dockerd` is a no-op when the daemon answers, and never launches a second `dockerd` when one is still coming up.
- `dokploy-down.sh` ignores already-removed services/containers/volumes.
- The two failure traps in `dokploy-up.sh` exist precisely so a *partial* previous run (stale volume, bogus `traefik.yml` directory) can't silently produce a crash-looping "successful" install.

## Environment variable reference

| Variable | Used by | Meaning |
|---|---|---|
| `ADVERTISE_ADDR` | `dokploy-up.sh` (via `lib.sh`) | Override the auto-detected Swarm advertise IP |
| `DOKPLOY_VERSION` | `dokploy-up.sh` | Pin a Dokploy image version; defaults to `latest` |
| `FORCE=1` | `dokploy-up.sh` | Install even when a leftover `dokploy-postgres` volume exists |
| `PURGE=1` | `Makefile` (`make down`) | Pass `--purge` to `dokploy-down.sh` |
