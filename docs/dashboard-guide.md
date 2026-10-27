# Switchyard dashboard guide

Switchyard is the Railway-style dashboard in [`dashboard/`](../dashboard/) that drives a [Dokploy](https://dokploy.com) install. Everything Dokploy can run — applications, managed databases, docker-compose stacks — appears as a node on one canvas, and each service gets a drawer with its configuration, lifecycle controls, live logs, and live metrics.

This guide tours the features. To install the stack and connect Switchyard to it (admin credentials, `.env.local`, ports), follow [getting-started.md](getting-started.md) first; for how it all works internally, see [architecture.md](architecture.md); when something breaks, see [troubleshooting.md](troubleshooting.md).

> **Login required — but a login is not TLS.** Switchyard gates every page, action, and log/metric stream behind a per-user Dokploy login (`/login`). A signed-in user still holds full Dokploy admin (create/destroy services, read database passwords, stream logs) and traffic is plain HTTP — keep it on localhost (the default) or put an HTTPS proxy in front before exposing it. See the [security note in getting-started](getting-started.md#set-up-switchyard-both-platforms) and the security model in [architecture.md](architecture.md).

The screenshots use two running local demo services: `ogs-web` (`nginx:alpine`) and `ogs-redis` (`redis:7`), deployed as separate Compose stacks in `ogs-guide-r1 / ogs-demo`. Compose works on this test host's bridge network without Swarm. All service drawers show **Running** and **Last deploy: Succeeded**; the guide describes native application and managed-database controls separately where they differ from Compose.

Captured from dashboard revision `608d7cb` on localhost:3009 at 1440×900 with 2× device scale (2880×1800 PNGs). Both containers passed health checks, and the web container could reach Redis over their private network. The throwaway services were deleted after capture.

## The workspace

Open http://localhost:3001. The header reads **Services** ("Apps and databases across your Dokploy projects") and carries four controls on the right: a **Canvas | Grid** view toggle, **Projects**, **Refresh**, and the purple **New service** button. On a fresh install the workspace shows a "No services yet" placeholder with a New service button; once you have services, the canvas is the default view.

![Canvas view centered on the running ogs-web and ogs-redis Compose nodes in ogs-guide-r1 / ogs-demo, joined by an inferred dependency edge, with minimap and zoom controls](images/canvas-overview.png)

### Canvas view

Each service is a draggable card: an icon and accent color per kind (purple box for applications, engine-colored database icon for databases, teal layers for compose stacks), the service name, a subtitle with its Docker image or kind, and a status dot on the right. Each card also shows its project and environment, such as `ogs-guide-r1 / ogs-demo` above.

The animated dashed line from `ogs-web` to `ogs-redis` is an inferred connection: the web stack's environment variables reference the Redis service, so Switchyard draws an arrow from the consumer to its dependency. [How canvas connections work](#how-canvas-connections-work) explains the heuristic.

- Click a node to open its drawer.
- Drag nodes to arrange them; positions are remembered in your browser's localStorage (not on the server), so the layout is per-browser.
- Zoom controls sit bottom-left; the minimap bottom-right pans and zooms the viewport.

### Grid view

Click **Grid** in the header toggle for a flat card list — handy once the canvas gets busy or on narrow windows.

![Grid view including ogs-redis and ogs-web Compose cards with Running badges and their ogs-guide-r1 / ogs-demo scope, alongside other local demo services](images/grid-view.png)

The two `ogs-*` cards are Running. The shared local test workspace also contains unrelated Idle and Error cards.

Each card shows the same identity, status badge, and project/environment scope; click a card to open the drawer. Services that have never been deployed show a one-click **Deploy** button directly on the card.

### Projects and environments

Dokploy organizes services under **project → environment** (for example `My Project / production`). Click **Projects** in the header to manage that tree.

![Projects & environments panel showing ogs-guide-r1 with ogs-demo and the default production environment, rename and delete controls, Add env, and the new-project input](images/projects-view.png)

- Create a project with the **new project name** input at the bottom.
- Add an environment to a project with its inline **new environment** input and **Add env**.
- The pencil icon renames a project or environment (a browser prompt asks for the new name); the trash icon deletes it after a confirmation. Deleting a project deletes everything in it.

You don't have to set this up before deploying: if no project exists, the first quick deploy creates "My Project" with a default environment automatically. When more than one environment exists, the New service menu grows a selector at the top so you can pick where the service lands.

### Statuses and refresh

Every badge and canvas dot uses the same states:

| Badge | Meaning |
|---|---|
| Idle (gray) | Created but not deployed — nothing is running yet |
| Deploying (amber, pulsing) | A deployment is in progress |
| Running (green) | Deployed and up |
| Error (red) | The last operation failed |

The page renders from live Dokploy state on every load, and every action (deploy, save, destroy) refreshes it — but statuses do **not** poll in the background. If a deployment finishes while you're just looking at the canvas, click **Refresh** to see the badge flip. The Logs and Metrics tabs are the genuinely live parts. If instead of the workspace you see a red "Couldn't reach Dokploy" card, Switchyard can't talk to the Dokploy API — see [troubleshooting](troubleshooting.md#switchyard-shows-the-couldnt-reach-dokploy-card).

## Creating services

Click **New service** to open the creation menu. Everything here is one click (or one field) away from a deployed service; all details are editable afterward in the drawer.

![New service menu targeting ogs-guide-r1 / ogs-demo: application inputs, From GitHub, Compose stack, App catalog, and the five managed database engines](images/new-service-menu.png)

The **Application** section offers four ways in: deploy from a Docker image, deploy from a public Git URL, deploy through a GitHub App (including private repositories), or create a Compose stack. The **Database** section lists the five managed engines with the exact image each would deploy: `postgres:18`, `mysql:8.4`, `mariadb:11`, `mongo:8`, `redis:7`.

### One-click databases

Click an engine row and Switchyard provisions and deploys a database immediately — no form. It auto-generates:

- a friendly name: the engine plus a random suffix (for example `redis-mskd`),
- a random 20-character password,
- the newest curated version of the engine (the tag shown in the menu).

For PostgreSQL, MySQL, and MariaDB the user defaults to `admin` and the database name to the service name; MongoDB gets a user but no database name; Redis takes neither. The menu closes and the new database's drawer opens so you can watch it come up. Version, name, ports, and resource limits can all be changed later in [Settings](#settings-and-the-danger-zone).

### Deploy from a Docker image

Type any public image reference into the **docker image** field — `nginx:alpine`, `traefik/whoami`, `ghcr.io/org/app:tag` — and click **Deploy** (or press Enter).

![New service menu targeting ogs-guide-r1 / ogs-demo with nginx:alpine in the docker image field and the Deploy button enabled](images/deploy-image-filled.png)

Switchyard creates an application named after the image plus a random suffix (for example `nginx-ab12`), points it at the image, and deploys it. The drawer opens on the new service. There are no registry-credential fields in this menu, so the image must be publicly pullable. The screenshot shows the form before submission; the running demo uses Compose instead.

### Deploy from a Git repository

Paste a public clone URL (for example `https://github.com/you/my-app.git`) into the **git repo url** field and click **Deploy**. Switchyard creates an application named after the repository, sets it to build from the `main` branch at the repo root with **Nixpacks** (Dokploy's default buildpack — it detects the language and produces an image without a Dockerfile), and starts the first deployment.

The clone-URL field uses a direct public clone without a GitHub App. Builds take longer than image deploys; the service shows **Deploying** while Nixpacks works, and the [Deploys tab](#deployment-history) records the attempt and lets you change the branch.

For **private GitHub repositories**, use **New service → From GitHub**. This requires a GitHub App created and installed in Dokploy with access to the repository. App creation happens in Dokploy's Git-provider settings and requires a public callback URL.

1. Choose an **Installation** (selected automatically if there is only one).
2. Choose a **Repository** and **Branch**. Private repositories are marked `(private)`; the repository's default branch is preselected when available.
3. Click **Deploy**. Switchyard creates an application, configures the GitHub source at the repository root, and deploys it. Push auto-deploy is enabled for the selected branch through the App's webhook.

If no GitHub App is connected, the modal shows **Connect GitHub App**, linking to Dokploy's settings. Create and install the App there, then return and click **Refresh**. The public clone-URL field remains available without an App.

### Compose stacks

Click **Compose stack** and Switchyard immediately creates the service — again, no form. It appears on the canvas as **Idle** (nothing is running yet) and its drawer opens. On the **Compose** tab you'll find the editor seeded with a starter `docker-compose.yml`. The starter file runs nginx and publishes it on port 8080:

```yaml
services:
  web:
    image: nginx:alpine
    ports:
      - 8080:80
```

Replace it with your own stack, then click **Save & deploy** to store the file and deploy it in one step (**Save** stores it without deploying). Until you deploy, the stack stays Idle — if you close the drawer without saving, the idle service still exists and can be deployed or destroyed later. Compose stacks have a **Variables** tab for their environment variables; save there and redeploy for changes to take effect.

The running `ogs-web` example below uses a customized file: nginx, a health check, a 128 MB memory limit, a `REDIS_URL` variable, and a shared bridge network. It publishes no host ports.

![ogs-web Compose editor: Running and Last deploy: Succeeded, saved nginx:alpine configuration with REDIS_URL, health check and shared network, plus Save and Save & deploy controls](images/compose-editor.png)

## Working with a service

Click any node or card to slide in the service drawer from the right. The header shows the service's icon, name, status badge, and its kind and scope (for example "Docker image · My Project / production"). Close it with the X or by clicking the dimmed canvas.

The tab row depends on the service kind:

| Kind | Tabs |
|---|---|
| Application | Overview · Variables · Deploy · Build · Networking · Deploys · Schedules · Volumes · Metrics · Logs · Console · Settings |
| Database (PostgreSQL, MySQL, MariaDB, MongoDB, Redis) | Overview · Variables · Volumes · Metrics · Logs · Console · Backups · Settings |
| Compose stack | Overview · Variables · Networking · Deploys · Compose · Volumes · Metrics · Logs · Console · Settings |

**Data** also appears immediately after **Overview** for databases whose engine is `postgres` or whose image contains `postgres`, and for compose stacks with an `image:` value containing `postgres` (case-insensitive).

There is no separate "Source" tab — an application's source (Docker image or Git repository) is shown on its Overview tab.

### Overview and lifecycle

Overview shows lifecycle buttons for the service's current state (see the [lifecycle reference](#lifecycle-reference)) and the service's key facts. The web service below runs as a Compose stack:

![ogs-web Compose Overview: Running and Last deploy: Succeeded, Public URL empty state pointing at Networking, Stop and Redeploy buttons, Type and App name fields](images/app-overview.png)

Compose Overview shows **Public URL**, **Type**, and **App name**, with a pointer to the Compose editor. Native application Overview also includes source and build details:

- **Public URL** — an attached domain, as a clickable link; before you attach one it reads "No domain yet — add one under Networking."
- **Source** — where the app comes from (`docker` for image deploys, the Git provider for repo deploys), with the **Image** or **Repository** next to it.
- **Build** — Dokploy's build type. It defaults to `nixpacks`, which is what actually builds Git deploys; for image-based apps the field is informational only.
- **Replicas** — how many task instances run.

A managed database Overview shows the connection string (next section) plus image, internal port, replicas, database/user names, and resource limits. The Redis example here runs in Compose, so it has the same Compose Overview fields as the web stack:

![ogs-redis Compose Overview: Running and Last deploy: Succeeded, Stop and Redeploy controls, Public URL empty state, Type and App name fields](images/db-overview.png)

### Database connection strings

For a native managed database, open **Overview** to copy its connection string. Compose stacks do not generate this field; use the database's configured credentials and its service name or network alias on a shared Docker network.

A managed database's string is the **internal** address: its host is the service's *app name* (the generated identifier shown in Settings) and its port is the engine's default port. Once the database is running, that name resolves on the Dokploy overlay network, so the string works from other services deployed on the same stack — it will not work from your laptop. To reach a managed database from outside, set an **External port** in Settings instead, which publishes the engine's port on the host.

The format per engine:

| Engine | Internal connection string |
|---|---|
| PostgreSQL | `postgresql://user:password@app-name:5432/database` |
| MySQL / MariaDB | `mysql://user:password@app-name:3306/database` |
| MongoDB | `mongodb://user:password@app-name:27017` |
| Redis | `redis://default:password@app-name:6379` |

The copy button at the end of the field copies the full string.

### Environment variables

The **Variables** tab (applications, databases, and compose stacks) is a plain-text editor: one `KEY=value` per line, with `#` lines treated as comments. The counter under the editor tallies the real variables, and **Save variables** stays disabled until you change something. As the hint says, redeploy the service for changes to take effect.

![ogs-web Compose Variables: Running and Last deploy: Succeeded, saved REDIS_URL=redis://ogs-redis:6379, the 1 variable counter, and disabled Save variables button](images/app-variables.png)

Here `ogs-web` carries one saved variable, `REDIS_URL=redis://ogs-redis:6379`. The two Compose stacks share a private bridge network where `ogs-redis` is the Redis service's alias. This password-free URL belongs to the isolated throwaway demo; use your database's configured credentials in your own connection string. The reference also draws a canvas edge because its value contains the Redis service's display name. Nginx does not consume Redis itself; this variable demonstrates passing configuration to a container, and connectivity was checked separately.

### Domains

The **Networking** tab (applications and compose stacks) attaches hostnames. Enter the **Host** (for example `app.example.com`), the container **Port** your app listens on (default 80), and click **Add**. For compose stacks, also choose the target **Service** within the stack. Custom domains default to HTTPS and Let's Encrypt; the application form lets you change these options.

![ogs-web Compose Networking: Running and Last deploy: Succeeded, No domains attached, Service set to ogs-web, Host and Port fields, Generate URL and Add buttons](images/app-domains.png)

For custom public hostnames:

- **DNS** — point the domain's records at the server, as the tab's hint says.
- **Traefik** — routing requires a proxy. The Linux installer (getting-started Path A) runs Dokploy's Traefik automatically; on the manual Windows path it's an [optional step](getting-started.md#5-traefik-optional). CLI/desktop local ingress is described below.

Attached domains appear as clickable rows above the form; Overview uses the first HTTPS domain as the Public URL, falling back to the first domain if none use HTTPS.

**Auto-URL.** When `SWITCHYARD_HOST_IP` is set (the CLI detects it on Linux), quick-deploying an app attempts to mint a public URL automatically (a Dokploy `*.traefik.me` host, or `<app-name>.<server-ip>.sslip.io` — both resolve to the server with no DNS to configure) and it shows up as the Public URL on the Overview tab. It routes to container port `3000` by default; if your app listens on a different port, add a domain here with the right port.

Without `SWITCHYARD_HOST_IP` (Docker Desktop and a default manual/dev setup), deploy-time auto-URL is disabled. **Generate URL** in Networking can still attach an HTTP `.localhost` domain on the form's selected port. Routing requires a proxy: CLI/desktop installs support opt-in local ingress (`switchyard local-ingress up`, default HTTP port `8080`; open `http://<generated-host>:8080`). A manually run dashboard needs a separately configured proxy or that same local ingress.

### Deployment history

The **Deploys** tab (applications and compose stacks) lists every deployment, newest first. Each row shows a status dot (green done, red error, amber in progress), the deployment title, its timestamp, and the status as text — so after a few redeploys you can see at a glance when the app last shipped cleanly and whether anything failed. A never-deployed app shows "No deployments yet."

The tab also carries the **push-to-deploy** controls for apps created from a public clone URL (`git` source): the branch, an auto-deploy toggle, watch paths, and the app's copyable Dokploy webhook URL — add it as a push webhook on your Git host and every push to the configured branch redeploys. GitHub App deployments use the App's webhook instead. Rows whose deployment produced a registry image snapshot show a **Roll back** button (Dokploy records these only when the app deploys to a registry with rollbacks enabled).

Per-deployment build logs aren't viewable in Switchyard yet (it's on the [dashboard roadmap](../dashboard/README.md#status)). To follow a deploy as it happens, watch the status badge and switch to Logs once the container starts.

### Live logs

Every kind has a **Logs** tab that streams the service's container output live — no page reloads. It opens with the last 300 lines and then follows:

![ogs-redis Compose Logs: Running and Last deploy: Succeeded, real timestamped Redis startup lines ending with Ready to accept connections, Filter logs field and green Live indicator](images/db-logs.png)

- The green **Live** dot confirms the stream is connected.
- Each line is prefixed with its timestamp in your local time.
- **Filter logs…** narrows the view to lines containing your text (case-insensitive, applied live).
- The view sticks to the bottom as lines arrive; scroll up to pause following, scroll back down to resume. The buffer is capped at a couple thousand lines, so very chatty services roll off the top.

If the service isn't running you'll get a placeholder line instead of a stream. For a dashboard run manually/from source on Windows, check the Docker socket configuration if Logs and Metrics are empty — see [troubleshooting](troubleshooting.md#logs-and-metrics-tabs-are-empty-on-windows). CLI/desktop-managed dashboard containers mount the Docker socket automatically.

### Live metrics

The **Metrics** tab samples the container's CPU and memory roughly once a second while the tab is open:

![ogs-redis Compose Metrics: Running and Last deploy: Succeeded, live CPU and memory readings with a 128 MB memory limit, populated CPU and Memory charts, and history off](images/db-metrics.png)

The two cards show the latest sample — CPU percentage, and memory used "of" the container's limit (128 MB in this example; when no limit is set, Docker reports the host's total). Below them, area charts fill with real samples while the tab is open; hover for exact values. History is off on this test dashboard, and HTTP metrics are unavailable because no Traefik metrics endpoint is configured. A stopped service shows "No metrics — the service isn't running."

### Settings and the danger zone

The **Settings** tab depends on the service kind. A Compose stack shows its app name, creation date, and Danger zone; edit its image, environment, and resource limits in Compose or Variables. Here is the running Redis stack:

![ogs-redis Compose Settings: Running and Last deploy: Succeeded, App name, Created timestamp, and Danger zone with Destroy ogs-redis](images/db-settings.png)

Native managed databases have additional Settings controls:

- **Name** — rename the service (display name only; the app name is fixed).
- **Version** — a dropdown of curated tags per engine (PostgreSQL 18/17/16/15, MySQL 8.4/8.0, MariaDB 11/10, MongoDB 8/7/6, Redis 7/6). As the hint warns, changing it redeploys.
- **External port** — publish the database on the host to reach it from outside the stack; "blank = internal only".
- **CPU limit / Memory limit** — Docker-format strings, e.g. `0.5` CPUs and `256m` of memory; blank means unlimited.
- **Save changes** applies the edits; version, port, and resource changes are pushed to the running container.
- **Password** — masked by default, with reveal and copy buttons (rotation is "coming soon").
- **App name** and **Created** — the generated Swarm identity (the hostname other services use) and the creation timestamp.

Application Settings offer name and CPU/memory limits (saving a resource change triggers a redeploy) plus the app name; compose Settings show only the app name and creation date.

Every Settings tab ends in the red **Danger zone**: a **Destroy** button that removes the service and its container(s) — for compose stacks, the whole stack and all its containers. A browser confirmation stands between you and the click, but there is no undo.

## How canvas connections work

Dokploy has no native "connect these services" concept, so Switchyard infers the arrows from environment variables: if service A's variables mention service B's app name (or its display name), an edge is drawn **from A to B** — from the consumer to the thing it depends on. That's why `ogs-web → ogs-redis` appears in the hero screenshot: the web stack's `REDIS_URL` contains the Redis service's display name. Edges animate and take the color of the service they point at.

Practical consequences:

- **To create an edge**, put a real reference in the consumer's Variables — pasting a database's internal connection string is the canonical way.
- **To remove one**, delete the referencing variable and refresh.
- **False positives happen.** The match is a plain substring check, so if one service's name happens to appear inside an unrelated variable value — or inside another service's name — you may get an arrow that means nothing. Cosmetic only; it changes no behavior.

## Lifecycle reference

All three kinds share the same verbs. The buttons on Overview change with the current status; Destroy always lives in Settings.

| Verb | Where | What it does |
|---|---|---|
| Deploy | Overview (when Idle), or the card in grid view | First deployment: pull/build and start |
| Redeploy | Overview (any deployed state) | Re-run the deployment — pick up new images, variables, or compose edits |
| Stop | Overview (when Running) | Stop the container; configuration and data volumes stay |
| Start | Overview (after a stop, failed deploy, or while one is in flight) | Start it again without a full redeploy |
| Destroy | Settings → Danger zone | Remove the service and its container(s), after a confirmation — irreversible |

By status: **Idle** shows Deploy; **Running** shows Stop and Redeploy; **Deploying** and **Error** show Start and Redeploy.

## Tips and limits

- **No dashboard auth.** Worth repeating: whoever reaches the Switchyard port is a Dokploy admin. Keep it local or gate it ([details](getting-started.md#set-up-switchyard-both-platforms)).
- **Canvas layout is per-browser.** Node positions live in your browser's localStorage — another browser or machine sees the default column layout, and clearing site data resets yours.
- **Edges are a heuristic.** Substring matching over env vars catches the common cases and occasionally invents an arrow; treat the canvas lines as hints, not truth.
- **Statuses don't auto-refresh.** Click **Refresh** to see a background deployment finish; only Logs and Metrics stream live.
- **Source access.** The New service image and clone-URL fields take public sources; **From GitHub** supports private repositories through an installed GitHub App. The quick-deploy fields have no registry-credential or deploy-key inputs.
- **Not there yet** (per the [dashboard roadmap](../dashboard/README.md#status)): per-deployment build logs and database password rotation. (Backups and dashboard auth shipped — see the Backups tab and `/login`.)
