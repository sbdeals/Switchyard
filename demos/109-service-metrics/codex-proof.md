# Service metrics proof

Local-only proof on http://127.0.0.1:3040 against this VM's Dokploy. No production deployments accessed.

## Result

- Live Compose service: `service-metrics-burner-wjhafy`; BusyBox 1.37 busy loop, `cpus: 0.5`, `mem_limit: 32m`, no exposed ports.
- Final capture: 8 distinct samples, CPU 48.56–49.85%, memory 495,616 bytes (484 KB), limit 33,554,432 bytes (32 MB).
- Requests every approximately 5 seconds; switching to Overview stopped requests and returning to Metrics resumed them.
- Unknown service returned 403. No browser page errors.
- `01-not-running.png`: service before deployment.
- `02-live-metrics.png`, `03-resumed-metrics.png`: real live Docker measurements.
- `service-metrics.mp4`: final recording, H.264, 1440×900, 39.32 seconds (initial login trimmed).
- `live-results.json`: samples, request intervals, and assertions.
- `compose.yaml`: exact fixture.
- `fixture.json`, `cleanup.json`: own fixture identifiers and successful dashboard/API cleanup.

## Checks

`cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run`

PASS: lint (no warnings), TypeScript, 56 tests across 5 files.

`git diff --check`

PASS.

`sudo docker build -q -t switchyard-dash:service-metrics dashboard`

PASS. The throwaway runtime image added only `ENV SWITCHYARD_ALERTS=off` to disable the existing background alert sender during proof, then ran with `/tmp/runsy.sh sy-service-metrics 3040 service-metrics`.

`BASE=http://127.0.0.1:3040 node /workspace/sy-codex-notes/fix/service-metrics-proof/proof.mjs capture`

PASS: eight unique real samples; pause/resume; unauthorized name denied. Final proof was repeated after changing cache TTL to 4.5 seconds to leave headroom for five-second polling and variable workspace lookup latency.

## Files changed in repository

- dashboard/.dockerignore (exclude test sources from deployment image; provided Vitest remains local)
- dashboard/vitest.config.mjs
- dashboard/src/lib/container-stats.ts and container-stats.test.ts
- dashboard/src/lib/docker.ts and docker-stats.test.ts
- dashboard/src/lib/dokploy.ts and workspace-metrics.test.ts
- dashboard/src/app/api/services/metrics/route.ts and dashboard/src/lib/metrics-route.test.ts
- dashboard/src/components/service/MetricsTab.tsx
- dashboard/src/lib/service-metrics-client.ts and service-metrics-client.test.ts

## Limits

Live metrics aggregate running service containers; the existing durable-history collector and historical ranges are unchanged. Five-minute retention, multi-container totals, cross-user ownership, failures, and concurrency limits are covered by Vitest; the real recording uses one container and one demo account. Authorization deliberately re-reads workspace/project.all and service details on every poll, so large workspaces incur additional Dokploy reads. The live endpoint now returns JSON instead of SSE. No lockfiles changed, no dependencies installed, and no commits created.

## Cleanup

The own Compose fixture and proof project (including its environments) were deleted through dashboard/Dokploy APIs. Docker queries confirmed no fixture containers or service-metrics networks remained. The temporary sy-service-metrics dashboard, its data volume, and its image tag were removed afterward. Pre-existing demo resources were left intact.
