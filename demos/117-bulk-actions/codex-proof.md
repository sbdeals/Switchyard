# Bulk actions local proof

Final proof passed (exit 0) against `http://127.0.0.1:3048`, using only the local Dokploy API at `http://127.0.0.1:3000` and newly created `bulk-actions-*` fixtures. No pre-existing services were selected or mutated.

Implementation checks, all passed on the final source:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Vitest: 2 files, 29 tests passed. From the worktree root, `sudo docker build -q -t switchyard-dash:bulk-actions dashboard` and `git diff --check` also passed. No lockfiles or existing server actions changed.

After proof, the session-created dashboard container `sy-bulk-actions`, volume `sy-bulk-actions-data`, and image tag `switchyard-dash:bulk-actions` were removed. Port 3048 is no longer serving the proof dashboard.

Exact proof command:

```sh
BASE=http://127.0.0.1:3048 node /workspace/sy-codex-notes/fix/bulk-actions-proof/proof.mjs > /workspace/sy-codex-notes/fix/bulk-actions-proof/run.log 2>&1
```

Passed assertions:

- Created three independent busybox:1.37 compose services, bulk-actions-a/b/c, in newly created bulk-actions-proof project.
- Grid checkbox selection and Shift-click range selected exactly these three services.
- Selection survived dashboard Refresh and Grid/Canvas view changes.
- Cancel left selection intact without executing. Canvas Shift-click selected the three services without opening a drawer.
- Initial progress appeared in 109 ms before the first server action response: two Running, one Queued.
- Restart completed 3 OK; exact-name Docker ps and inspect state showed all three running.
- Stop completed 3 OK; all three containers existed and were exited.
- Start completed 3 OK; all three were running again.
- After opening a confirmation snapshot, deleted only this run's bulk-actions-b through Dokploy API. Restart reported its expected 404 failure while bulk-actions-a and bulk-actions-c completed OK and remained running.
- Deleted service was removed from selection after refresh.
- Deleted remaining fixtures and project through Dokploy API. Separate API verification and Docker check show no fixture projects, services, or containers remain.

Evidence:

- `bulk-actions.mp4`: final browser recording, 134.6 seconds.
- `02-grid-selected.png`, `03-canvas-selected.png`: selection views.
- `04-restart-*`, `05-stop-*`, `06-start-*`: confirmations, progress, results, Docker JSON, and screenshots of those observed Docker reports.
- `07-forced-failure-*`: isolated failure and surviving service results/states.
- `08-cleanup.png`, `08-cleanup-docker.json`, `08-cleanup-api.json`: cleanup evidence.
- `run.log`, `results.json`: assertion results. `created.json`: IDs created by this run and deletion flags.
- `first-pass/`: superseded initial proof, retained for debugging the initial progress rendering issue; use the artifacts above for review.

Limitations: live lifecycle coverage is compose-only (Restart/Stop/Start); Redeploy, application/database backends, and the >3-service typed Stop gate were not exercised live here. The pure runner permits at most two active service tasks, but Next's client server-action dispatcher can serialize individual RPCs; simultaneous Docker operations are not guaranteed. Docker screenshots render the actual timestamped ps/inspect JSON in a separate evidence page; they are not screenshots of an interactive terminal.
