# Service rename proof

Implemented display-name editing from the drawer header (Enter saves, Escape cancels) and Settings, plus optional descriptions. Names trim to 1–63 characters. Same-environment duplicates warn but save. Updates resolve targets through the signed-in user's `project.all` and send only the type-specific ID, `name`, and optional `description` to Dokploy's update endpoint. No `appName`, deploy, or reload request is sent.

Changed files:

- `dashboard/.dockerignore` — omit test source from the production image; the provided local node_modules has Vitest, but the locked production build dependencies do not.
- `dashboard/src/app/actions.ts`
- `dashboard/src/components/Workspace.tsx`
- `dashboard/src/components/service/AppTabs.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/service/ServiceDetails.tsx`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/service-name.ts`
- `dashboard/src/lib/service-name.test.ts`
- `dashboard/src/lib/service-details.test.ts`

Checks:

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — passed; 2 test files, 28 tests. Covers trim/length, duplicate warning scope, all seven update routes, project-tree authorization and expired sessions, payload allowlisting, optional descriptions and hydration, and update failures without restart attempts.
- `git diff --check` — passed.
- `sudo docker build -q -t switchyard-dash:service-rename dashboard && /tmp/runsy.sh sy-service-rename 3038 service-rename` — passed; local dashboard returned HTTP 200 on :3038.
- `BASE=http://127.0.0.1:3038 node /workspace/sy-codex-notes/fix/service-rename-proof/proof.mjs` — passed. The script imports the authorized demo login helper; no credentials or cookies are saved in these artifacts.
- An accidental `npx vitest run` from the repository root ran the unrelated CLI/MCP node:test files and failed because their built output/dependencies were absent. The required dashboard invocation above passed. The root runner's temporary cache was removed.

Artifacts:

- `service-rename.mp4` — successful browser proof recording.
- `01-before.png` through `07-settings-reloaded.png` — before, inline edit, duplicate warning, saved Settings, updated grid, reloaded canvas, and persisted Settings.
- `evidence.json` — raw selected Dokploy metadata and filtered Docker evidence before the header save, after the header save, and after Settings plus reload.
- `proof.mjs` — repeatable local fixture/proof/cleanup script.

The final proof renamed `service-rename-original` → `service-rename-header` → a permitted duplicate → `service-rename-settings`. The container remained running with unchanged ID, name `service-rename-fixture-d2xxp4-app-1`, start time, and Dokploy appName `service-rename-fixture-d2xxp4`. The script also verifies that a header rename preserves an unsaved description draft. The throwaway compose services and project were deleted through Dokploy APIs. The session-created dashboard container, its data volume, and its tagged image were removed afterwards.

Limitations: live mutation proof covers compose only. Application and all five database update paths are covered by request-mocked Vitest tests and verified against the official Dokploy v0.30.10 schemas: https://github.com/Dokploy/dokploy/tree/v0.30.10/packages/server/src/db/schema . No production deployment, paid API, or other worktree was accessed. No commit or lockfile changes.
