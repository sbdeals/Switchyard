# Operator guide screenshots — review round 1

All 13 guide screenshots were captured from this branch's dashboard code with healthy throwaway Compose examples. The seven failed-state drawer images from the initial attempt have been replaced. All service drawer captures show **Running** and **Last deploy: Succeeded**.

Source: `/workspace/wt-operator-guide-screenshots`, revision `608d7cbce0e64577b771ce65fb5a68964de54940`, base `codex/operator-guide-refresh`. The repository diff contains only 13 PNGs, `docs/images/manifest.json`, and `docs/dashboard-guide.md`. No dashboard code, dependencies, lockfiles, commits, or pushes changed.

Build and launch commands, both successful:

```sh
sudo docker build -q -t switchyard-dash:ogs-r1 dashboard
/tmp/runsy.sh sy-ogs-r1 3009 ogs-r1
```

Image used: `sha256:87a52c15642cf51e66fe323041fe99482b81222cf458c656af982cb082758d98`.

The captures used the supplied local Playwright/login helper at `http://127.0.0.1:3009`, with a 1440×900 viewport and device scale factor 2. Every PNG is 2880×1800; the service drawers retain the 576px width and x=864 framing. No DOM content, API responses, logs, metrics, or status values were fabricated. Only the two throwaway canvas nodes were repositioned, using real pointer drags, pan, and zoom. Browser requests were restricted to the local dashboard origin.

Local resources created through Dokploy:

- Project `ogs-guide-r1`, environment `ogs-demo` (Dokploy also created its required empty `production` environment).
- Compose stack `ogs-web`, public image `nginx:alpine`, HTTP health check, 128 MB memory limit.
- Compose stack `ogs-redis`, public image `redis:7`, Redis PING health check, 128 MB memory limit.
- Bridge network `ogs-r1-network`, created by Redis's Compose definition and shared with the web stack.

Neither stack published host ports. `REDIS_URL=redis://ogs-redis:6379` was saved through `compose.saveEnvironment` and interpolated into the web container. Nginx does not use Redis itself; this is an example of container configuration and an inferred canvas edge. The Redis connection was separately checked from inside the web container. No public domain, ingress route, webhook, or production resource was configured or accessed.

Health and connectivity checks passed:

```sh
sudo docker inspect --format '{{.Name}} {{.State.Status}} {{.State.Health.Status}}' ogs-redis-r1-zo2i5q-ogs-redis-1 ogs-web-r1-srighc-ogs-web-1
sudo docker exec ogs-web-r1-srighc-ogs-web-1 wget -q -O /dev/null http://127.0.0.1/
sudo docker exec ogs-web-r1-srighc-ogs-web-1 sh -c 'printf "PING\r\n" | nc -w 2 ogs-redis 6379'
sudo docker exec ogs-redis-r1-zo2i5q-ogs-redis-1 redis-cli ping
```

Both containers reported `running healthy`; HTTP exited 0, the cross-container Redis check returned `+PONG`, and the local Redis check returned `PONG`. The dashboard canvas reported both services Running. Dokploy recorded both deployments as `done`. The metrics screenshot used 19 actual Docker samples observed over the dashboard's SSE connection.

| PNG | What it shows |
|---|---|
| app-overview.png | Running web Compose stack, successful deploy, Public URL empty state, lifecycle controls, Type and App name. |
| app-variables.png | Running web stack with one saved REDIS_URL and a disabled Save variables button. |
| app-domains.png | Running web stack's Compose Networking form, target service, port 80, and Generate URL. |
| db-overview.png | Running Redis Compose stack, successful deploy, lifecycle controls, Type and App name. |
| db-logs.png | Real Redis startup output ending in Ready to accept connections, with the green Live indicator. |
| db-metrics.png | Real CPU and memory samples and charts, including the 128 MB memory limit. |
| db-settings.png | Running Redis stack's App name, creation timestamp, and Danger zone. |
| canvas-overview.png | The two running Compose nodes centered on the canvas, joined by the inferred dependency edge. |
| compose-editor.png | The running web stack's saved nginx YAML, health check, REDIS_URL, and private network. |
| new-service-menu.png | Creation menu targeting ogs-guide-r1 / ogs-demo over the healthy canvas. |
| deploy-image-filled.png | nginx:alpine entered in the image deployment form; the form was not submitted. |
| grid-view.png | Both running ogs-* cards alongside the shared test workspace's existing service cards. |
| projects-view.png | The throwaway project and its environments, alongside an existing local test project. |

Limitations are explicit in the guide and manifest: the views are Compose surfaces, so native application and managed-database fields are described separately. Redis startup output includes the host's memory-overcommit warning; no host setting was changed. Metrics history is off and HTTP metrics are unavailable without a Traefik metrics endpoint. Grid view includes unrelated pre-existing Idle/Error demo cards; these were not modified. None of the ogs-* service captures requires or retains a failed state. Native Swarm deployment, public routing, and HTTP/metrics history were not proven by this review round.

Dashboard checks:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Lint passed (exit 0), TypeScript passed (exit 0), and Vitest v3.2.7 exited 1 with `No test files found`. There are no test files on this base. This change only updates documentation and captured images.

Artifact checks:

```sh
git diff --check
python3 /workspace/sy-codex-notes/fix/operator-guide-screenshots-proof/verify.py
```

Both passed. The verifier checks all 13 image dimensions and hashes, before/after copies, guide references, manifest descriptions, all eight service-drawer states and bounds, 19 real metrics samples, healthy containers without published ports, recorded API cleanup, and the exact 15-file documentation diff. All images were visually inspected.

Cleanup succeeded through `compose.delete` (web first, Redis second) and `project.remove`. `project.all` confirmed the project was removed. Docker queries confirmed no containers or labeled volumes remained for either Compose project and `ogs-r1-network` was gone. The session-created dashboard container `sy-ogs-r1`, its `sy-ogs-r1-data` volume, and the `switchyard-dash:ogs-r1` image tag were removed. Port 3009 is free. No raw SQL or broad Docker cleanup was used, and no pre-existing service/container was deleted or stopped.

Proof layout:

- `before/`: all 13 original repo images and original guide/manifest.
- `after/`: all 13 final images and updated guide/manifest, byte-identical to the repository diff.
- `review-round1/before/`: the state presented for review, including the seven rejected failed-state captures.
- `review-round1/after/`: the final healthy captures and documentation.
- `review-round1/resources.json`: own resource IDs, successful deployment records, and API deletion confirmation.
- `review-round1/runtime-proof.json`: both containers healthy with no host-port bindings immediately before cleanup.
- `review-round1/captures.json`: actual service names, tabs, Running/Succeeded states, and drawer bounds.
- `review-round1/canvas-status.json`: actual accessible labels for both Running canvas nodes.
- `review-round1/redis-metric-samples.json`: the 19 real SSE metric samples.
- `review-round1/resources.mjs`, `capture.mjs`, `workspace.mjs`, and Compose YAML files: local setup/capture procedure.
- `sha256.json`: original, review-before, and final PNG hashes.
- `initial-attempt/`: archived notes and scripts from the initial native deployment attempt, superseded by this review round.
