# Project Activity proof

Local dashboard: http://127.0.0.1:3050 (`sy-project-activity`, image `switchyard-dash:project-activity`). Existing local Dokploy history only; no demo applications were created, deployed, deleted, or otherwise changed. No production services were accessed.

## Change

Read-only Activity drawer from the workspace header. Lists visible application/Compose deployment history newest first, with project/status filters, service/environment, title, status, relative start time (absolute hover), and duration. Clicking a row opens that service's Deploys tab. GET `/api/activity` uses `loadWorkspace`, returns only display fields, and sets `Cache-Control: private, max-age=10, must-revalidate` plus `Vary: Cookie`. The client waits 10 seconds after each request finishes and aborts/clears polling on close.

## Files touched

- `dashboard/src/components/ActivityPanel.tsx`
- `dashboard/src/components/Workspace.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/app/api/activity/route.ts`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/activity.ts`
- `dashboard/src/lib/activity-feed.ts`
- `dashboard/src/lib/activity.test.ts`
- `dashboard/src/lib/activity-feed.test.ts`
- `dashboard/src/lib/activity-route.test.ts`
- `dashboard/src/lib/dokploy-activity.test.ts`

## Exact checks

From `/workspace/wt-project-activity`:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: ESLint, TypeScript, and all 49 tests in four files. Tests cover safe normalization, ordering, status/project filters, relative time/duration, per-user route isolation, non-cacheable failures, auth redirects, Dokploy field mapping, request pacing, slow requests, abort/cleanup, and retries. No packages were installed and no lockfiles changed.

```sh
git diff --check
sudo docker build -q -t switchyard-dash:project-activity dashboard
/tmp/runsy.sh sy-project-activity 3050 project-activity
BASE=http://127.0.0.1:3050 node /workspace/sy-codex-notes/fix/project-activity-proof/proof.mjs
```

Whitespace check and Docker build passed. Dashboard returned 200 on port 3050. Browser assertions and observed request spacing are recorded in `results.json`; `proof.mjs` reproduces the local read-only checks using the provided demo login helper without persisting credentials.

Browser proof passed with 26 existing deployments across 12 services. Open refresh requests were 10,227 ms apart; there were no activity requests before opening or during the 11-second waits after closing. The MP4 is 60.64 seconds, H.264, 1440×900.

## Artifacts

- `01-workspace.png`: Activity entry point in header.
- `02-all-activity.png`: existing deployment history.
- `03-filtered-activity.png`: combined project/status filter.
- `04-empty-filter.png`: no matching deployments.
- `05-service-deployments.png`: selected service's Deploys tab.
- `06-mobile-activity.png`: narrow viewport.
- `activity.mp4`: browser recording (login excluded).

## Limits

The feed uses application/Compose history exposed by Dokploy; managed databases do not have this deployment history. Missing finish timestamps render an unavailable duration. The local history exercised done/error; other status and duration cases are covered by unit tests. Dokploy v0.30.10 has running/done/error/cancelled status values; missing/idle values normalize to queued.

Field source: https://raw.githubusercontent.com/Dokploy/dokploy/v0.30.10/packages/server/src/db/schema/deployment.ts

No commit or push was made. The local proof dashboard remains available on port 3050 for review.
