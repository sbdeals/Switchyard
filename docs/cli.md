# The `switchyard` CLI

`switchyard-cli` (npm) is the one-command installer and manager for the whole
stack: Dokploy + the Switchyard dashboard + the Claude Code handoff. The bin
it installs is called `switchyard`.

> **npm naming note:** the package is `switchyard-cli` — the bare name
> `switchyard` on npm is an unrelated, abandoned package. Never run
> `npx switchyard`; it resolves to the wrong thing.

## Install

Fresh Linux server (installs Docker and Node.js if missing, then runs `up`):

```bash
curl -fsSL https://raw.githubusercontent.com/sbdeals/switchyard/main/install.sh | bash
```

Anywhere with Node 20+ and Docker (including Windows 11 with Docker Desktop
and macOS). The real requirement is a Docker engine with **Swarm support**,
not Docker Desktop specifically — on macOS, [OrbStack](https://orbstack.dev)
and [Colima](https://github.com/abiosoft/colima) both qualify and are detected
automatically: if `docker` isn't on PATH or its daemon doesn't answer, the CLI
probes the well-known OrbStack (`~/.orbstack/run/docker.sock`) and Colima
(`~/.colima/default/docker.sock`) sockets and adopts whichever answers (via
`DOCKER_HOST`, using OrbStack's bundled docker CLI if needed):

```bash
npx switchyard-cli up
```

Flags after the curl form reach `up` too:

```bash
curl -fsSL .../install.sh | bash -s -- --headless --email you@example.com --password s3cret
```

## What `up` does

1. **Checks prerequisites** — Docker CLI and daemon (on Linux it can start
   `dockerd` itself, via the repo's launch scripts; on macOS any Swarm-capable
   engine works — Docker Desktop, OrbStack, or Colima).
2. **Detects existing installs and port conflicts** — an already-deployed
   `dokploy` service has its published port *adopted* into the config; busy
   ports get an interactive suggestion or a `--dokploy-port`/`--dashboard-port`
   hint.
3. **Stands up Dokploy** (idempotent):
   - *Linux*: runs the repo's `scripts/dokploy-up.sh` under sudo — same code
     path as `make up`, including the no-systemd, registry-mirror, and dnsrr
     workarounds.
   - *Windows/macOS (Docker Desktop)*: replays the manual procedure
     from [getting-started.md](getting-started.md#path-b-windows-11-with-docker-desktop)
     programmatically — Swarm init, overlay network, secrets, `/etc/dokploy`
     pre-creation inside the VM, and the three services (ingress publish).
     Tested end-to-end on Windows 11; macOS shares this code path but is not
     yet verified end-to-end.
4. **Creates the Dokploy admin from the terminal** — prompts for email and
   password (or generates one), registers via
   `POST /api/auth/sign-up/email`, and verifies by signing in. If the install
   already has an admin, it asks for those credentials instead and validates
   them. Nothing to copy into env files.
5. **Runs the dashboard as a managed container** —
   `ghcr.io/sbdeals/switchyard`, attached to `dokploy-network` (it reaches
   Dokploy at `http://dokploy:3000` by service DNS; for the auth Origin header
   the dashboard probes both that URL and the host-facing
   `DOKPLOY_ORIGIN=http://localhost:<port>`, since which one Dokploy trusts
   changed across Dokploy versions), Docker socket mounted for live
   logs/metrics,
   `--restart unless-stopped`, published on **127.0.0.1**:3001 by default.
   Then verifies `/api/health?deep=1` — a full container → Dokploy sign-in —
   before declaring success.
6. **Offers Claude Code** — installs `@anthropic-ai/claude-code` globally if
   missing; `switchyard claude` launches it (its own first run signs you in).

Re-running `up` converges: same config → no-op; changed config or a newer CLI
version → the container is recreated (that's also the upgrade path:
`npx switchyard-cli@latest up`).

The CLI mounts the named Docker volume `switchyard-data` at `/app/data` and
sets `SWITCHYARD_AGENT_KEY_FILE=/app/data/agent-key.json`. This explicit setting
keeps the dashboard's development default unchanged. Saved agent provider,
API key, and OAuth state, plus other files written under `/app/data` (including
dashboard backups), survive container replacements. The desktop app calls the
same launcher and inherits this storage.

On the first replacement of an older container without this volume, the
launcher migrates its saved agent key file before removing the old container.
If migration fails, replacement aborts and the old container is retained so
the settings can be recovered. An identical file already in the volume is safe
to retry; conflicting contents abort instead of overwriting either copy.
This migration does not recover files from a container that has already been
deleted or copy other legacy files outside the agent key file.

## Commands

| Command | What it does |
|---|---|
| `switchyard up` | Install/converge/upgrade the whole stack (idempotent) |
| `switchyard deploy [path]` | Upload and deploy a local directory to Dokploy (see flags below) |
| `switchyard link` | Remember an existing project, environment, and application for this directory |
| `switchyard variables [list\|set\|unset]` | List or edit application variables (values are masked by default) |
| `switchyard status` | Services, container health, URLs, config path |
| `switchyard down` | Stop the stack; data volumes survive, including `switchyard-data` |
| `switchyard down --purge` | Also delete network, secrets, and volumes, including saved agent settings/backups in `switchyard-data` (fresh slate; clears stored admin creds) |
| `switchyard config list \| get <k> \| set <k> <v>` | Read/change persisted settings; `set` recreates the container |
| `switchyard local-ingress up \| down` | Opt-in demo Traefik on alternate ports so domains route locally over **HTTP** (see below) |
| `switchyard doctor` | Read-only prerequisite + health check |
| `switchyard logs [switchyard\|dokploy] [-f]` | Tail the dashboard container or the Dokploy service logs |
| `switchyard open` | Open the dashboard in a browser |
| `switchyard claude [args...]` | Launch Claude Code (installs it first if needed) |

`down --purge` verifies that `switchyard-data` was removed and reports a failure
if Docker cannot remove it (for example, another container still uses it).
Plain `down` preserves the volume for the next `up`.

### `up` flags

| Flag | Meaning |
|---|---|
| `--dokploy-port <n>` | Host port for Dokploy (default 3000; ignored when an existing install is adopted) |
| `--dashboard-port <n>` | Host port for the dashboard (default 3001) |
| `--expose` | Publish the dashboard on all interfaces — a Dokploy login is required but there's **no TLS**; requires confirmation (`--yes` in scripts) |
| `--skip-traefik` | Don't run the Traefik proxy (domains won't route); default on Docker Desktop |
| `--tag <tag>` | Dashboard image tag (default: the CLI's own version; `latest` works too) |
| `--email` / `--password` / `--admin-name` | Dokploy admin identity (otherwise prompted or generated) |
| `--headless` | Never prompt; generate missing credentials; implies `--no-claude` |
| `--no-claude` | Skip the Claude Code step |
| `--force` | Install over leftover Dokploy data volumes (the scripts' `FORCE=1`) |
| `--yes` | Assume yes on confirmations |

Environment passthrough: `ADVERTISE_ADDR` and `DOKPLOY_VERSION` are honored
exactly as documented for `scripts/dokploy-up.sh`.

### Deploy a directory

`switchyard deploy` is the Railway `up` equivalent: it deploys the current
directory. `switchyard up` continues to install and start the platform.

```bash
switchyard deploy
switchyard deploy ./my-app --service web --project demos
switchyard deploy . --service web --project demos --detach
```

| Argument / flag | Meaning |
|---|---|
| `[path]` | Directory to upload (default: the current directory) |
| `--service <name>` | Reuse or create an application with this exact name in the linked or selected environment (default: linked service or directory name) |
| `--project <name>` | Reuse or create a project with this exact name |
| `--detach` | Return once the deployment is queued, without waiting for the result |
| `--include-env` | Allow `.env` and `.env.*` files through the env-file guard; ignore rules still apply |

With no target flags, deploy uses `.switchyard/link.json` in the current
directory, even when uploading a different `[path]`. `--service` overrides
the linked application within its environment. `--project` selects a project
by name and ignores the link; without `--service`, the application name then
defaults to the upload directory name. A stale link fails with guidance to
run `switchyard link` again.

Without a link or `--project`, the CLI uses the only existing project, or creates
`Default` if there are none. If several projects exist, choose one with
`--project`. Within that project it uses the `production` environment, or
the only environment if there is no `production`; ambiguous selections fail
with guidance instead of choosing a target silently. The application name
defaults to the upload directory name when no link or `--service` is supplied.

The directory needs a root `Dockerfile`, or a project Dokploy can build with
Nixpacks: Node (`package.json`), Python (`requirements.txt`, `pyproject.toml`,
or `Pipfile`), or Go (`go.mod`). Other projects need a `Dockerfile`.

The CLI uploads a ZIP using Dokploy's drop deployment source. Reusing an
application replaces its source and build type; its variables and domains
remain configured. Packing honors
`.gitignore` files, including nested ones, and the root `.dockerignore`
(or `Dockerfile.dockerignore`, which takes precedence when present).
Negation (`!`) rules apply within each ignore system; Docker rules never
override Git exclusions. The `Dockerfile` and Docker ignore files are
retained despite Docker exclusions so builds can use them. `.git`,
`.switchyard`, and `node_modules` are always excluded. Files named `.env` or
`.env.*` at any depth are excluded by default, except `.env.example`; the CLI
prints the excluded paths. Use `--include-env` to opt in to uploading these
files (it does not override Git or Docker ignore rules). Symlinks are skipped
with a notice.
Both the total included file size and the ZIP are
limited to 100 MiB; use ignore rules to remove build output or other large
files if the upload is too large. Dokploy's ZIP extraction does not preserve
executable bits; if the build runs uploaded scripts, make them executable
in the Dockerfile (for example, `RUN chmod +x ./start.sh`).

Deploy uses the local Dokploy port and admin credentials saved by
`switchyard up`. Missing credentials, rejected login, or a stopped platform
produce an error before deployment. By default it polls the new deployment
for up to 15 minutes and exits with an error on failure or timeout. It prints
an existing application URL when available; attach a domain in the dashboard
if the application has none. Deploy does not create domains.

### Link a directory

```bash
switchyard link --project demos --service web
switchyard deploy
```

`link` selects existing resources only. `--project` and `--service` accept
an exact name or ID. Without `--project`, there must be only one project.
The environment is `production`, or the only environment if there is no
`production`. Without `--service`, it selects the application matching the
current directory name, or the only application. Ambiguous selections fail
with guidance.

The command writes project, environment, and application IDs to
`.switchyard/link.json` in the current directory and prints a reminder to
add `.switchyard/` to your `.gitignore`. It does not edit `.gitignore` for
you. Re-run `link` to change the target or replace a stale link.

### Manage application variables

```bash
switchyard variables                         # same as variables list
switchyard variables list --reveal
switchyard variables set NODE_ENV=production 'GREETING=hello world'
switchyard variables unset GREETING
switchyard variables set NODE_ENV=production --deploy
switchyard variables list --service web
```

Variables use the linked application. `--service <name-or-id>` selects a
different application in the linked environment; without a link, it must
uniquely identify an existing application across projects and environments.
These commands use the local Dokploy configured by `switchyard up`.

`list` masks values unless `--reveal` is given. `set KEY=VALUE...` and
`unset KEY...` preserve other variables, comments, and lines in the app's env
configuration. Changes print `redeploy to apply`; add `--deploy` to queue a
deployment of the application's configured source immediately instead.
New keys must use letters, digits, and underscores, without a leading digit.
Values that cannot be represented safely in dotenv are rejected before saving.

## Configuration

Setup never requires editing a file; everything `up` decides is persisted so
you can change it **afterwards**:

| OS | Config file |
|---|---|
| Linux | `/etc/switchyard/config.json` |
| Windows | `%APPDATA%\switchyard\config.json` |
| macOS | `~/Library/Application Support/switchyard/config.json` |

Override the location with the `SWITCHYARD_CONFIG` environment variable. The
file is mode 0600 — it stores the Dokploy admin password (that's how the
dashboard container gets its credentials without hand-edited env files).

| Key | Default | Meaning |
|---|---|---|
| `dokployPort` | `3000` | Host port Dokploy publishes (adopted from existing installs) |
| `dashboardPort` | `3001` | Host port the dashboard publishes |
| `expose` | `false` | `false` = bind 127.0.0.1 |
| `skipTraefik` | `false` on Linux, `true` on Docker Desktop | Skip the reverse proxy |
| `localIngress` | `false` | Opt-in demo Traefik (see [Local ingress](#local-ingress-demo-domain-routing)); `up` re-converges it when set |
| `localIngressHttpPort` | `8080` | Host HTTP port for the demo proxy |
| `localIngressHttpsPort` | `8443` | Host HTTPS port for the demo proxy |
| `adminName` / `adminEmail` / `adminPassword` | — | The Dokploy admin the dashboard signs in with |
| `sessionSecret` | `""` (generated at install) | CSPRNG secret that signs the dashboard's session cookie |
| `image` | `ghcr.io/sbdeals/switchyard` | Dashboard image repo |
| `imageTag` | `""` (= CLI version) | Pin a dashboard image tag |
| `dokployUrlInContainer` | `http://dokploy:3000` | How the container reaches Dokploy (service DNS) |
| `hostIp` | `""` (auto-detected on Linux) | Host public/advertise IP handed to the dashboard as `SWITCHYARD_HOST_IP` so app deploys mint an auto-URL (traefik.me / sslip.io) with no DNS. `""` disables auto-URL (Docker Desktop / dev). Override with `config set hostIp <ip>` |
| `store` | `true` | Provision the `switchyard-metrics` Postgres so dashboard metrics persist; `false` turns the store off |
| `storePassword` | `""` (generated once) | CSPRNG password for the `switchyard-metrics` Postgres |

Change a setting and apply it in one step — `set` recreates the container
when the value affects it:

```bash
switchyard config set dashboardPort 3101
switchyard config set adminPassword <new-password>   # after changing it in Dokploy
switchyard config set imageTag latest                # track latest instead of the CLI version
```

Editing the JSON by hand is fine too — run `switchyard up` afterwards to
converge (it recreates the container only when the rendered spec's hash
changed). `switchyard config list` and `set` confirmations redact
`adminPassword`, `sessionSecret`, and `storePassword` unless you pass
`--show-secrets`. `switchyard config get <key>` always returns the raw value,
including secrets, without requiring `--show-secrets`.

If service DNS doesn't work in your setup, point the container at the host
instead:

```bash
switchyard config set dokployUrlInContainer http://host.docker.internal:3000
```

## Local ingress (demo domain routing)

On Docker Desktop `switchyard up` sets `skipTraefik` — there is no reverse
proxy, so attaching a domain to an app has no effect (it does not route). On a
Linux/VPS install the stack instead runs a real Traefik on **80/443** with
Let's Encrypt, and that is where real HTTPS custom domains belong.

For a **local demo** of domain routing, `local-ingress` runs a *second* Traefik
on alternate host ports (default **8080/8443**) that reuses the config Dokploy
already generates:

```bash
switchyard local-ingress up      # start it (persists the choice)
switchyard local-ingress down    # stop it
```

- **HTTP only — this is NOT real TLS.** Let's Encrypt needs a public host
  answering on 80/443; the demo proxy cannot issue certificates. On these
  domains choose certificate **"None"** and untick **HTTPS** in the dashboard.
- Deploy an app first (that makes Dokploy write the Traefik config), then start
  it. Point the domain at `127.0.0.1` (your hosts file) and open
  `http://<host>:8080`.
- Off by default; it does not change `skipTraefik` or any default behavior.
  Once enabled, `switchyard up` re-converges it (so it survives a reboot), and
  `switchyard down` removes it. It honors the same exposure model — bound to
  127.0.0.1 unless the stack is exposed. Change the ports with
  `config set localIngressHttpPort <n>` / `localIngressHttpsPort <n>`.
- On Windows/macOS the demo proxy is driven with `docker` directly; on Linux it
  runs `scripts/local-ingress.sh`. For a real public HTTPS domain, use a
  Linux/VPS install (Traefik + Let's Encrypt on 80/443) or a tunnel such as
  `cloudflared`.

## Security: login required, but no TLS

The dashboard requires signing in with a **Dokploy account** at `/login` (the
first admin the CLI registers works). A signed-in user holds full Dokploy admin
— database passwords, container logs, service lifecycle — and the dashboard
itself speaks plain HTTP. Because of that:

- The container binds **127.0.0.1** by default. On a server, reach it with an
  SSH tunnel:

  ```bash
  ssh -L 3001:127.0.0.1:3001 you@your-server
  # then open http://localhost:3001 locally
  ```

- `--expose` (or `config set expose true`) binds 0.0.0.0 and makes the CLI
  shout at you first. On an internet-reachable machine, put an HTTPS reverse
  proxy in front — credentials and session cookies should not cross networks
  in the clear.

## Migrating an existing install

**A server already running Dokploy (e.g. installed by `make up` or dokploy.com's
installer):** just run `up`. It detects the `dokploy` service, adopts its
published port, asks for the existing admin credentials (terminal prompt),
and adds the managed dashboard container. If you previously ran the dashboard
with `npm run dev`/`npm run start`/systemd, stop that process first or pass
`--dashboard-port` — the default 3001 will conflict.

**A Windows machine with the Path B stack (Dokploy on :3300):** run
`npx switchyard-cli up`. The :3300 publish is adopted automatically; enter
your existing admin email/password when prompted. A host-side dev dashboard
on :3101 can be retired afterwards, or kept — give the container a different
port with `--dashboard-port` if you want both.

**Fresh slate:** `switchyard down --purge` then `switchyard up`.

## Developing the dashboard (dev mode)

Contributors keep the classic loop — the CLI doesn't change it:

```bash
cd dashboard
cp .env.example .env.local   # DOKPLOY_URL / DOKPLOY_EMAIL / DOKPLOY_PASSWORD
npm install
npm run dev                  # http://localhost:3001
```

Dev mode and the managed container read the same four env vars; the container
just gets them injected by the CLI instead of from `.env.local`. Building the
production image locally:

```bash
docker build -t ghcr.io/sbdeals/switchyard:dev dashboard/
switchyard config set imageTag dev
```

## Relationship to `make up`

The Makefile targets are unchanged and remain the contributor-facing path on
Linux; on Linux the CLI literally runs the same `scripts/*.sh` (they ship
inside the npm package). `switchyard up` adds what the scripts don't do:
admin registration, the managed dashboard container, config persistence, and
Windows/macOS support.
