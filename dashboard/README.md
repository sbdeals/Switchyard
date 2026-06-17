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
src/app/actions.ts    Server Actions: create / lifecycle / create-project
src/app/page.tsx      Server component: fetches the live tree, renders the view
src/components/       DatabasesView, DatabaseCard, NewDatabaseDialog, StatusBadge
```

## Status

- [x] List databases across projects with live status
- [x] Create + deploy a database (engine, version, project/env, credentials)
- [x] Lifecycle: deploy / start / stop / redeploy / destroy
- [x] Reveal + copy connection string
- [ ] Logs & metrics, backups, applications (next)
