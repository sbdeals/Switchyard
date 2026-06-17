# dokploy-claudecode

An open-source, Railway-style PaaS built on top of [Dokploy](https://dokploy.com)
and driven by [Claude Code](https://claude.com/claude-code).

This repo holds the launch tooling for running **Dokploy** and **Claude Code**
on this machine. The next milestone is a Railway-like dashboard layered on top
of Dokploy's API.

## Quick start

```bash
make up        # launch Dokploy (Docker daemon + Swarm + services + Traefik)
make status    # show stack status and the dashboard URL
make claude    # launch Claude Code in this repo
make doctor    # verify prerequisites for both tools
make down      # stop the stack (make down PURGE=1 to also wipe data)
```

After `make up`, open the dashboard at **http://localhost:3000** (or
`http://<server-ip>:3000`). On first run Dokploy redirects to `/register` so you
can create the admin account.

## What `make up` does

`scripts/dokploy-up.sh` is idempotent and brings up the whole stack:

| Component          | Image              | Role                                |
|--------------------|--------------------|-------------------------------------|
| `dokploy`          | `dokploy/dokploy`  | Web dashboard + API (port **3000**) |
| `dokploy-postgres` | `postgres:16`      | Application database                |
| `dokploy-redis`    | `redis:7`          | Queue / cache                       |
| `dokploy-traefik`  | `traefik:v3.6.7`   | Reverse proxy (ports **80/443**)    |

Postgres, Redis and Dokploy run as **Docker Swarm services**; Traefik runs as a
plain container attached to the `dokploy-network` overlay.

## Environment notes (why this isn't just `curl | sh`)

This host needed two adjustments beyond the stock Dokploy installer. Both are
handled automatically by the scripts here:

1. **Docker Hub pull-rate limit.** The shared cloud egress IP hits Docker Hub's
   anonymous pull limit. `scripts/lib.sh` configures a pull-through mirror
   (`https://mirror.gcr.io`) in `/etc/docker/daemon.json`, which serves the same
   images without the limit.

2. **No IPVS in the kernel** (`CONFIG_IP_VS is not set`). Docker Swarm's default
   service VIP load-balancing relies on IPVS, so service-to-service traffic
   (e.g. Dokploy → Postgres) silently fails even though DNS resolves. The
   scripts deploy every service with **`--endpoint-mode dnsrr`** (DNS
   round-robin), which resolves service names straight to task IPs and bypasses
   IPVS. This reuses the same code path Dokploy ships for Proxmox LXC hosts.

There is also no `systemd` here (PID 1 is a sandbox supervisor), so the Docker
daemon is started directly by the scripts rather than via `systemctl`.

## Repo layout

```
Makefile               # convenience targets (up / status / down / claude / doctor)
scripts/
  lib.sh               # shared helpers: dockerd, mirror, advertise addr, waits
  dokploy-up.sh        # launch Dokploy (idempotent)
  dokploy-status.sh    # stack status + dashboard URL
  dokploy-down.sh      # stop the stack (--purge to wipe data)
  claude-up.sh         # launch Claude Code in this repo
  doctor.sh            # prerequisite / environment check
```

## Roadmap

- [x] Install and launch Dokploy on this host
- [x] One-command launch for Dokploy and Claude Code
- [ ] Railway-style dashboard on top of the Dokploy API
