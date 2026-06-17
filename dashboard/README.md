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

- **Auth**: the server signs into Dokploy with admin credentials from
  `.env.local` and reuses the session cookie. Credentials never reach the
  browser. (Dokploy also has an `x-api-key` token gated behind the
  `canAccessToAPI` member permission — a drop-in upgrade later.)
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
| `DOKPLOY_EMAIL` | admin account email |
| `DOKPLOY_PASSWORD` | admin account password |

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

- [x] List databases across projects with live status
- [x] **One-click deploy** — pick an engine and it provisions a random name,
      password, and latest version, then deploys (no form). Configure after.
- [x] Lifecycle: deploy / start / stop / redeploy / destroy
- [x] **Railway-style canvas** (React Flow): draggable nodes, persisted layout,
      env-inferred connection arrows, minimap; live-syncs on data change
- [x] **Service drawer** with tabs: Overview/Config, Variables (env editor),
      live **Metrics** (CPU/memory charts), live **Logs**, and an **editable
      Settings** tab (rename, version, port, CPU/memory limits) + danger zone
- [ ] Applications & compose nodes, domains, backups, deploy-log history (next —
      see the porting roadmap in the repo plan)
