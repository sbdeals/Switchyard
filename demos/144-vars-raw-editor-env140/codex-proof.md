# Vars / Raw editor env140 proof

Merge conflicts resolved in place; all repo changes staged, uncommitted. MERGE_HEAD remains present for the lead to conclude the merge.

Rows/Raw, review, and export now start from the ownership-checked env action, with a loading skeleton. The editor owns its loaded/saved baseline. Every service env and every database password is null in workspace page props. Database connection/password controls use a separate ownership-checked password-only action.

## Verification

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — exit 0; 6 files, 99 tests passed.
- `sudo docker build -q -t switchyard-dash:vars-raw-editor-env140 dashboard` — exit 0; image `sha256:56d19450177864ae9f611d9fafa3eee86b622c7ae9d4188c3c415954f077f9f5`.
- `/tmp/runsy.sh sy-vars-raw-editor-env140 3077 vars-raw-editor-env140` — local login HTTP 200.
- `BASE=http://127.0.0.1:3077 node /workspace/sy-codex-notes/fix/vars-raw-editor-env140-proof/proof.mjs` — exit 0; 49 checks passed; compose/project removed via dashboard server-action API; names absent afterward.
- `git diff --cached --check && git diff --exit-code && git diff --name-only --diff-filter=U && git rev-parse -q --verify MERGE_HEAD` — exit 0; no whitespace errors, unstaged changes, or unresolved conflicts; merge still pending.

## Evidence

- `report.json`: generated sentinel, fixture IDs, boolean assertions and response byte counts. Before opening Variables and after saving: all 22 services had null env, all 4 databases had null passwords; sentinel absent from HTML and RSC.
- `01-before-variables.png` through `10-reopened-persisted.png`: real browser screenshots for loading, loaded Rows/Raw, edits, masked review, clean save, exports and reopened values.
- `flow.mp4`: H.264, 1440x900, 12.48 seconds. `flow.webm` is the source recording.
- `proof.mjs`: reproducible local proof; does not persist complete workspace responses or credentials.
- `attempt-1/`: initial selector-only failure and successful cleanup evidence. Selector fixed before the successful run.

Only the disposable dashboard container remains on port 3077 for review. Both attempts' throwaway project/compose resources were deleted through the API. No pre-existing applications were changed or deployed.

## Files in the staged merge diff

- `dashboard/.dockerignore`
- `dashboard/src/app/actions.ts`
- `dashboard/src/app/page.tsx`
- `dashboard/src/components/service/DatabaseCredentials.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/service/VariablesTab.tsx`
- `dashboard/src/lib/database-credentials.test.ts`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/dotenv-editor.test.ts`
- `dashboard/src/lib/dotenv-editor.ts`
- `dashboard/src/lib/service-environment.test.ts`
- `dashboard/src/lib/service-redaction.test.ts`
- `dashboard/src/lib/service-redaction.ts`
- `dashboard/src/lib/variables-editor.test.ts`
- `dashboard/vitest.config.mjs`

The incoming redundant `variables-editor.ts` reducer was consolidated into the existing dotenv editor reducer. `.dockerignore`, Vitest config and the env action/redaction tests originated in #140. Lockfiles unchanged.

## Limits

The live editor flow used an undeployed Compose fixture. Application/database env loading, database credential loading, and ownership denial are covered by Vitest; their full browser flows were not exercised. No deploy/redeploy was needed or tested. Redaction covers env and databasePassword; unrelated existing configuration fields were outside this focused change.
