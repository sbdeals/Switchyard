# Switchyard — dashboard

A Railway-style control plane for [Dokploy](https://dokploy.com). First milestone:
**managed databases** (Postgres, MySQL, MariaDB, MongoDB, Redis).

Built with Next.js 16 (App Router) + TypeScript + Tailwind v4 + Framer Motion.

## How it works

The dashboard is a **backend-for-frontend (BFF)** over the Dokploy API:

```
browser ──> Switchyard (Next.js server) ──> Dokploy API (:3000)
            holds the Dokploy session,        projects / environments /
            never exposes it to the client     postgres|mysql|… resources
```

- **Auth**: users sign in at `/login` with their **own Dokploy account**. The
  BFF holds each user's Dokploy session cookie inside a sealed (AES-256-GCM)
  Switchyard session cookie; a proxy gate (`src/proxy.ts`) blocks every other
  route until it's present. The admin credentials in `.env.local` serve one
  purpose only: the `/api/health?deep=1` installer probe. Credentials never
  reach the browser.
- **Data model**: Dokploy nests a database under `project → environment`.
  `project.all` returns the tree (trimmed to IDs), so each database is enriched
  via `<engine>.one`. See `src/lib/dokploy.ts`.
- **Mutations**: create / deploy / start / stop / destroy run as Next.js Server
  Actions (`src/app/actions.ts`) and `revalidatePath` the page.

## Run locally

Dokploy must be running first (`make up` from the repo root).

```bash
cp .env.example .env.local   # then fill in DOKPLOY_EMAIL / DOKPLOY_PASSWORD
npm install
npm run dev                  # http://localhost:3001  (Dokploy owns :3000)
```

| Env var | Meaning |
|---|---|
| `DOKPLOY_URL` | Dokploy base URL (default `http://localhost:3000`) |
| `DOKPLOY_EMAIL` | admin email — used only by the `/api/health?deep=1` probe |
| `DOKPLOY_PASSWORD` | admin password — same single purpose |
| `SWITCHYARD_SESSION_SECRET` | signs/encrypts the session cookie (required) |

See `.env.example` for the optional auto-URL (`SWITCHYARD_HOST_IP`) and
observability persistence/alerting (`SWITCHYARD_STORE_URL`, `SWITCHYARD_ALERT_*`)
variables.

## Bridge database backups

Switchyard-managed compose databases have a **Backups** tab with **Back up now**,
**Download**, and a confirmed **Restore**. PostgreSQL uses custom-format dumps;
MySQL/MariaDB use SQL dumps; MongoDB uses gzip archives. Redis backups are not
supported yet. Native Dokploy database backups keep their existing S3 workflow.

Backups stream through the Docker socket into
`SWITCHYARD_BACKUP_DIR/<appName>/<UTC timestamp>.<ext>`. The default is
`./data/backups`, or `/app/data/backups` in the dashboard image. The runner is root
and can create this directory. **Mount a persistent volume before taking backups**:
add `-v switchyard-data:/app/data` to the dashboard's `docker run` options, or mount
a writable directory at the configured `SWITCHYARD_BACKUP_DIR`. The existing
launchers do not add this volume automatically. Without it, replacing the dashboard
container loses backups. Files are private (0600); database directories are 0700.
Backups contain sensitive database contents and are not encrypted at rest.

The latest 10 successful backups per database are retained; incomplete dumps are
never offered for download or restore. Download a copy for off-host protection.
Downloads and every backup action recheck the signed-in user's Dokploy access.
Credentials come from the running database container and never enter dump/restore
arguments. MongoDB tools read a temporary 0600 config, removed after the operation.

Stop application writes before restoring and keep a fresh backup first. Restores
replace objects present in the backup; objects created after the backup may remain.
PostgreSQL/MySQL/MariaDB cover the configured application database, not global
roles or server settings. MongoDB restores application namespaces, preserving
`admin`, `config`, and `local` (including current login credentials). Mongo dumps
without a replica-set oplog and SQL dumps of nontransactional tables require
quiescent writes for consistency. Use the same engine/version for restore.

Operations run synchronously and require a running database, the local Docker
socket, free disk space, and request timeouts long enough for the dump/restore.
A lock serializes backups/restores per database. After a dashboard crash, verify
no dump/restore process is still running before removing that database's
`.operation.lock` and abandoned `.partial` files. Removing a service does not
delete its backup directory; operators can remove it after keeping any needed
copies. Scheduled backups and S3 storage for bridge databases are follow-ups.

## Layout

```
src/lib/dokploy.ts    Typed, server-only Dokploy API client + session auth
src/lib/engines.ts    Per-engine display metadata (versions, accents, fields)
src/lib/docker.ts     Server-only Docker API access (logs + stats) via the socket
src/lib/connection.ts Connection-string builder shared by card and drawer
src/app/actions.ts    Server Actions: create / lifecycle / save-env / create-project
src/app/api/services/logs    SSE: streams container logs
src/app/api/services/metrics SSE: streams container CPU/memory samples
src/app/page.tsx      Server component: fetches the live tree, renders the workspace
src/components/       Workspace, DatabaseCard, NewDatabaseDialog, StatusBadge
src/components/canvas Railway-style React Flow canvas (FlowCanvas, ServiceNode)
src/components/service Service drawer + tabs (Overview, Variables, Metrics, Logs)
```

## Logs & metrics

The BFF runs on the host with access to the Docker socket (the same one Dokploy
uses), so live logs and metrics come straight from the **Docker API** — a
service's `appName` maps to its Swarm task container. The browser consumes two
Server-Sent-Event routes (`/api/services/logs`, `/api/services/metrics`); no
Dokploy WebSocket reverse-engineering needed. `dockerode` is kept out of the
bundle via `serverExternalPackages` in `next.config.ts`.

## Status

A unified **Service** model (`database | application | compose`) renders every
deployable on one canvas. See `src/lib/dokploy.ts` (`listServices`).

- [x] **Databases** (5 engines): one-click deploy (auto name/password/latest
      version), editable Settings (rename, version, port, CPU/memory), connection
      string, env editor
- [x] **Applications**: one-click deploy from a **Docker image** or a **public
      Git repo** (Nixpacks build); drawer tabs for Source, **Domains** (attach
      domain + auto-SSL), Variables, Metrics, Logs, editable Settings
- [x] **Compose**: create a `docker-compose` stack with an in-app YAML editor →
      Save & deploy
- [x] **Projects & environments**: create / rename / delete from the dashboard
- [x] Lifecycle for every kind: deploy / start / stop / redeploy / destroy
- [x] **Railway-style canvas** (React Flow): draggable nodes (per-kind icon &
      colour), persisted layout, env-inferred connection arrows, minimap;
      live-syncs on data change
- [x] Live **Logs** + **Metrics** straight from the Docker API (SSE)
- [x] **Dashboard auth** — per-user Dokploy login at `/login`; every route and
      Server Action is gated by `src/proxy.ts`, and log/metric streams only
      attach to Dokploy-managed containers
- [x] **Auto-URL** — deploying an app mints a public URL by default
      (`*.traefik.me` via Dokploy's generate-domain, or `<app>.<ip>.sslip.io`)
      on the Linux path
- [x] **Push-to-deploy & rollback** — per-app webhook URL + branch/auto-deploy
      controls in the Deploys tab; history rows with a registry snapshot can be
      rolled back
- [x] **Backups** — S3 destinations, scheduled backups (cron), back-up-now, and
      restore, per database
- [x] **Metrics history & alerts** — samples persist to the `switchyard-metrics`
      Postgres (survive tab close, range queries); crash-loops alert through
      Dokploy's notification channels
- [ ] Per-deployment build logs (next)
