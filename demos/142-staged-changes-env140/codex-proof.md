# Staged changes / env140 migration proof

Merge conflicts are resolved and the complete diff is staged for lead review. No commit was made; MERGE_HEAD remains present.

Service env and native DB passwords are removed from workspace page props. Variables loads env through the ownership-checked action, decodes stored reference templates, and retains the loaded/saved baseline across tab switches and partial apply failures. Reference pickers receive names only; validation runs server-side without returning resolved values. Native and managed DB credentials load on explicit reveal. Existing staged review, discard, deploy, and context-menu behavior remains.

## Checks

From `/workspace/wt-staged-changes-env140`:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: lint, TypeScript, 24 Vitest files / 578 tests.

```sh
sudo docker build -q -t switchyard-dash:staged-changes-env140 dashboard && /tmp/runsy.sh sy-staged-changes-env140 3074 staged-changes-env140
```

Passed. Final image: `sha256:16680880436791539f434ac609f1dea6dcf0ff4cf1689661d23e19134d2117c6`; login on port 3074 returned HTTP 200.

```sh
BASE=http://127.0.0.1:3074 node /workspace/sy-codex-notes/fix/staged-changes-env140-proof/proof.mjs
```

Passed all 12 live checks; see `report.json`, `proof.mp4`, and numbered screenshots. Authenticated HTML (112498 bytes) and RSC (38124 bytes, `text/x-component`) contained none of the unique env, managed DB, or native DB sentinels before Variables opened. The staged diff correctly showed one changed, one removed, and one added key, masking all values. Exactly one successful compose deployment started a container with the updated env and resolved reference. Discard, tab switching, post-save edit/revert, reference key picker, row context menu, and both database credential reveals passed.

All fixture services and their project were deleted through the Dokploy API. No fixture containers remain. The throwaway dashboard remains available on 3074. No production deployment, paid API, GitHub API, lockfile, or other worktree was touched.

## Files touched

- `dashboard/.dockerignore` (merged #140)
- `dashboard/vitest.config.mjs` (merged #140)
- `dashboard/src/app/actions.ts`
- `dashboard/src/app/page.tsx`
- `dashboard/src/app/reference-actions.ts`
- `dashboard/src/components/service/ComposeTabs.tsx`
- `dashboard/src/components/service/DatabaseCredentials.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/service/StagedChanges.tsx`
- `dashboard/src/components/service/VariablesTab.tsx`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/reference-keys.ts`
- `dashboard/src/lib/reference-vars.ts`
- `dashboard/src/lib/service-redaction.ts`
- `dashboard/src/lib/variables-editor.ts`
- `dashboard/src/lib/compose-env-redaction.test.ts`
- `dashboard/src/lib/database-credentials.test.ts`
- `dashboard/src/lib/reference-actions.test.ts`
- `dashboard/src/lib/reference-vars.test.ts`
- `dashboard/src/lib/service-environment.test.ts`
- `dashboard/src/lib/service-redaction.test.ts`
- `dashboard/src/lib/variables-editor.test.ts`

## Limits

The end-to-end deployment proof uses the local bridge stack. Ownership denial and partial-save failure behavior are covered by unit tests, not a second live user or injected live failure. Existing raw compose-file and webhook page fields predate #85 and were not redesigned; this migration removes service env and native DB password fields and prevents env-derived reference/connection values from entering page props.
