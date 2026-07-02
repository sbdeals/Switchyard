# dokploy-claudecode

An open-source, Railway-style PaaS built on top of [Dokploy](https://dokploy.com)
and driven by [Claude Code](https://claude.com/claude-code).

Two pieces live here:

- **Launch tooling** (`Makefile` + `scripts/`) — one-command, idempotent install
  of the Dokploy stack (Swarm services + Traefik) on a Linux host, including the
  workarounds hostile environments need (no systemd, no IPVS, registry rate
  limits).
- **Switchyard** (`dashboard/`) — a Railway-style dashboard over the Dokploy
  API: one canvas for every service, one-click databases, app deploys from a
  Docker image or Git repo, compose stacks, live logs and metrics.

![Switchyard canvas with connected services](docs/images/canvas-overview.png)

## Quick start

**Linux server** (the native path):

```bash
make up        # install + launch Dokploy (Docker daemon, Swarm, services, Traefik)
make status    # stack status + URL (http://localhost:3000)
```

Open http://localhost:3000, create the admin at `/register`, then start the
dashboard:

```bash
cd dashboard
cp .env.example .env.local   # fill in DOKPLOY_EMAIL / DOKPLOY_PASSWORD
npm install
npm run dev                  # Switchyard on http://localhost:3001
```

**Windows 11**: the bash tooling doesn't run natively, but the whole stack runs
fine on Docker Desktop — follow the tested walkthrough in
[docs/getting-started.md](docs/getting-started.md#path-b-windows-11-with-docker-desktop).

Other targets: `make down` (`PURGE=1` wipes data), `make claude` (launch Claude
Code here), `make doctor` (check prerequisites).

## Switchyard at a glance

- **Unified canvas** — databases, applications, and compose stacks as draggable
  nodes (React Flow), with connection arrows inferred from env vars, a minimap,
  and a per-browser persisted layout. Grid and per-project views included.
- **Databases** — Postgres, MySQL, MariaDB, MongoDB, Redis: one-click deploy,
  connection strings, env editor, resource/version/port settings.
- **Applications** — deploy from a Docker image or a public Git repo (Nixpacks
  build); domains with auto-SSL, variables, deployment history.
- **Compose** — docker-compose stacks with an in-app YAML editor.
- **Live logs & metrics** — streamed straight from the Docker Engine API over
  SSE; no polling, no Dokploy WebSocket reverse-engineering.
- **Projects & environments** — create, rename, delete from the dashboard.

> **Security note:** Switchyard has no login of its own — anyone who can reach
> its port has full admin over Dokploy. Keep it on localhost or gate it before
> exposing it. (Dashboard auth is on the roadmap.)

## Documentation

| Doc | What's inside |
|---|---|
| [Getting started](docs/getting-started.md) | Install on Linux (`make up`) or Windows 11 (Docker Desktop), connect the dashboard, verification checklist |
| [Dashboard guide](docs/dashboard-guide.md) | Feature tour with screenshots |
| [Architecture](docs/architecture.md) | The BFF design, data model, SSE logs/metrics, canvas internals |
| [Launch tooling](docs/launch-tooling.md) | Every make target and script, and why they exist |
| [Troubleshooting](docs/troubleshooting.md) | Symptom → cause → fix, for both platforms |

## Repo layout

```
Makefile               # up / status / down / claude / doctor
scripts/               # bash launch tooling (Linux hosts)
  lib.sh               #   shared helpers: dockerd, mirror, advertise addr, waits
  dokploy-up.sh        #   install + launch Dokploy (idempotent)
  dokploy-status.sh    #   stack status + dashboard URL
  dokploy-down.sh      #   stop the stack (--purge to wipe data)
  claude-up.sh         #   launch Claude Code in this repo
  doctor.sh            #   prerequisite / environment check
dashboard/             # Switchyard (Next.js 16 + TypeScript + Tailwind v4)
docs/                  # documentation (see table above) + screenshots
```

## Environment notes

The launch scripts encode two workarounds that stock installers miss on
sandboxed hosts: a Docker Hub pull-through mirror (rate-limited shared egress
IPs) and `--endpoint-mode dnsrr` on every Swarm service (kernels without IPVS
can't route service VIPs). Details and symptoms live in
[docs/launch-tooling.md](docs/launch-tooling.md) and
[docs/troubleshooting.md](docs/troubleshooting.md).

## Roadmap

- [x] Install and launch Dokploy on this host
- [x] One-command launch for Dokploy and Claude Code
- [x] Railway-style dashboard on top of the Dokploy API (Switchyard): databases,
      applications, compose, projects, canvas, live logs/metrics
- [ ] Backups (S3 destinations) and deploy-log history
- [ ] Dashboard auth (gate Switchyard before it binds beyond localhost)
