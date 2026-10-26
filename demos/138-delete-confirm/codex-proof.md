# Delete confirmation proof

Implemented shared typed confirmation for project, environment, application, compose, database, and saved S3 destination deletion. Small row/schedule confirmations remain unchanged. Deletion API operations are unchanged; server actions now validate current-workspace membership before deletion.

Validated on the local dashboard at http://127.0.0.1:3069. This session created only delete-confirm-* fixtures, through local Dokploy API calls. Existing resource proof opened a project dialog and canceled it without submission. No deployment was triggered.

## Evidence

- `delete-confirm-proof.mp4`: full successful browser run.
- `01-project-impact.png`: project/environment/service/domain/volume/variable counts.
- `02-environment-*.png`, `03-service-*.png`: wrong-case names disabled and trimmed matching names enabled.
- `04-service-pending.png`: pending deletion state; form and cancel disabled.
- `05-service-inline-error.png`: generic inline error after simulated transport failure.
- `06-service-deleted.png`, `07-environment-delete-*.png`, `08-project-delete-*.png`, `09-project-deleted.png`: successful app/environment/project deletions.
- `10-existing-open-cancel-only.png`: existing resource dialog inspected and canceled.
- `results.json`: browser assertions, including focus wrapping, Escape cancellation and focus restoration.
- `cleanup.json`: API confirms zero delete-confirm-project-* projects remain.
- `proof.mjs`, `verify-cleanup.mjs`: replay scripts using the provided demo login helper. No credentials are embedded.

## Checks

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — passed; 4 test files, 59 tests.
- `sudo docker build -q -t switchyard-dash:delete-confirm dashboard` — passed.
- `/tmp/runsy.sh sy-delete-confirm 3069 delete-confirm` — local dashboard started, /login returned 200.
- `BASE=http://127.0.0.1:3069 node /workspace/sy-codex-notes/fix/delete-confirm-proof/proof.mjs` — passed all 17 browser assertions.
- `BASE=http://127.0.0.1:3069 node /workspace/sy-codex-notes/fix/delete-confirm-proof/verify-cleanup.mjs` — passed.
- `git diff --check` — passed.

## Files touched

- dashboard/src/app/actions.ts
- dashboard/src/components/DeleteConfirmDialog.tsx
- dashboard/src/components/ProjectsPanel.tsx
- dashboard/src/components/Workspace.tsx
- dashboard/src/components/service/AppTabs.tsx
- dashboard/src/components/service/BackupsTab.tsx
- dashboard/src/components/service/ComposeTabs.tsx
- dashboard/src/components/service/ServiceDrawer.tsx
- dashboard/src/components/service/primitives.tsx
- dashboard/src/lib/dokploy.ts
- dashboard/src/lib/delete-impact.ts
- dashboard/src/lib/delete-actions.test.ts
- dashboard/src/lib/delete-dialog.test.ts
- dashboard/src/lib/delete-impact.test.ts
- dashboard/src/lib/delete-impact-metadata.test.ts
- dashboard/tsconfig.json
- dashboard/vitest.config.ts

## Limits

Impact is a snapshot of loaded data. Missing metadata is marked unavailable. Compose-defined containers/volumes are listed separately; YAML volumes are not parsed into the attached-volume count. Named-volume data may remain on the host. Service membership checks load fresh workspace details, so a detail-fetch failure blocks deletion. Live destructive proof covered app/environment/project deletion; compose/database/S3 deletion paths have shared-dialog and server-action tests, but were not destructively exercised live. Test files are excluded from the production TypeScript build because this base's lockfile does not include Vitest; the provided node_modules supplies Vitest for checks. No lockfile changes or commits were made.

The session-owned sy-delete-confirm dashboard remains on port 3069 for review; its project/env/app fixtures have been removed.
