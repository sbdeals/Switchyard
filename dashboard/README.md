# Switchyard — dashboard

A Railway-style control plane for [Dokploy](https://dokploy.com). First milestone:
**managed databases** (Postgres, MySQL, MariaDB, MongoDB, Redis).

Built with Next.js 16 (App Router) + TypeScript + Tailwind v4 + Framer Motion.

## Themes

Choose **Light**, **Dark**, or **System** beside Sign out (also available on the
login screen). Dark is the default. The choice persists in localStorage;
System follows live `prefers-color-scheme` changes. A small inline script in
the root layout sets the theme before paint. Blocked storage falls back to
dark on the next load while the current page's switcher still works.

Theme colors live in `src/app/globals.css`, with light overrides under
`[data-theme="light"]`. `src/lib/contrast.test.ts` checks the actual CSS token
values: body, muted, and subtle text must each reach WCAG AA's 4.5:1 on the
page, elevated, surface, hover, and code backgrounds. Code, logs, charts, and
the React Flow canvas/minimap use these tokens too.

Hard-coded color audit (run from `dashboard`):

```bash
rg -n '#[0-9a-fA-F]{3,8}\b|bg-black|text-white|bg-white' src/components
```

| Previous component colors | Replacement |
|---|---|
| `#0b0b10` in AppTabs, ComposeTabs, ConsoleTab, DataTab, LogsTab, ServiceDrawer, VariablesTab, VolumesTab, primitives | `--color-code-bg` |
| MetricsTab `#12121a`, `#34344a` tooltip | `--color-bg-elevated`, `--color-border-strong` |
| MetricsTab `#a06bff`, `#3ecf8e`, `#4a9eff`, `#f5a623`, `#ff5c5c` | `--color-brand`, `--color-ok`, `--color-info`, `--color-warn`, `--color-danger` |
| MetricsTab `#ffffff08`, DataTab white row stripe | `--color-chart-cursor` |
| QuickDeployMenu `#2dd4bf`, `#a78bfa` and their `1a` backgrounds | `--color-teal`, `--color-violet` and their `-soft` tokens |
| FlowCanvas `#a06bff`, `#ffffff2b`, `#0a0a0fcc` | `--color-brand`, `--color-canvas-dots`, `--color-canvas-mask` |
| AgentPanel/ChangesBar `#000` shadows | `--color-shadow` |

No hex colors remain in components. White text on purple action buttons,
white switch knobs, and translucent black modal backdrops are intentional in
both themes. Fixed database identity colors in `src/lib/engines.ts` remain
decorative icon/edge accents; application and compose accents use theme tokens.
Alpha variants of service accents use `color-mix` so CSS variables work too.

Tests run with the workspace's preinstalled Vitest (`npx vitest run`). This
checkout's package manifest does not declare Vitest; test files are excluded
from the runtime Docker build context, which installs only declared dependencies.

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
