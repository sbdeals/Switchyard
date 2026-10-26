# Deployment insights proof

Local dashboard: http://127.0.0.1:3061, image `switchyard-dash:deploy-stats`, container `sy-deploy-stats`.

## Evidence

- `01-three-deploys.png`: two successes and one deliberate bad image tag; 67% success.
- `02-running.png`: fourth deployment running; timer verified from `running 1s` to `running 4s`.
- `03-complete.png`: four deployments, 75% success, 10s median, 35s p90.
- `04-mobile.png`: 390px viewport; deployment panel fits without horizontal overflow.
- `deploy-stats.mp4`: 52.64s H.264 recording (1440×900) covering history, live duration and completion.
- `ui-results.json`: browser assertions, including stable completed duration, polling stopped, absolute UTC tooltip and no page errors.
- `deployment-rows.json`: actual local Dokploy rows, restricted to IDs/status/timestamps.
- `fixture.json`: owned resource IDs and API cleanup timestamp.

Observed durations from actual startedAt/finishedAt pairs: 3.730s, 16.702s, 0.841s (failed), 35.938s. Median = 10.216s; nearest-rank p90 = 35.938s. Display formatting floors to whole seconds.

## Validation

`cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run`

Passed: lint, TypeScript, 3 test files / 52 tests. Tests cover mapping for applications and compose; missing/invalid/reversed timestamps; running/final duration; formatting; median/p90; cancelled/queued/running status handling; last-20 window; SVG bars; tooltips; rollback rendering; timer cleanup and completion polling.

`sudo docker build -q -t switchyard-dash:deploy-stats dashboard && /tmp/runsy.sh sy-deploy-stats 3061 deploy-stats`

Passed. Final image sha256:3f3605b97e800bd9bde77d3c1902d2ee646978845e96bad04fa632f98d22453a. Local login endpoint returned 200.

`BASE=http://127.0.0.1:3061 node /workspace/sy-codex-notes/fix/deploy-stats-proof/capture.mjs`

Passed all browser assertions. `mobile.mjs` refreshed the final mobile screenshot without creating another deployment.

`node /workspace/sy-codex-notes/fix/deploy-stats-proof/fixture.mjs cleanup`

Passed. Deleted the owned compose and project via local Dokploy API; verified project absent afterward and no fixture app container remained. The dashboard on :3061 is left available for review. No pre-existing apps were stopped or deleted.

`git diff --check`

Passed. No commits or lockfile changes.

## Boundaries

- Dokploy v0.30.10 schema and actual compose rows have nullable startedAt and finishedAt. Cancelled/legacy/malformed timing cases are covered by tests, not the four live deploys.
- Relative labels refresh on mount, refreshed history, and while a measured deployment is running. Idle histories do not maintain a background clock.
- Vitest is present in the supplied node_modules but absent from this base's package manifest/lockfile. Dependencies were left unchanged as requested. Test files are excluded from the Docker build context so the production build does not depend on Vitest.
- The summary considers the newest 20 deploys; success rate and duration samples include only done/error outcomes. Cancelled, queued, running and unknown statuses are excluded from those aggregates. Missing timestamps display an em dash with “duration unavailable”.
