# Unsaved guard on env redaction

Merge conflicts are resolved and all task files are staged. The merge remains uncommitted for the lead.

Variables load through the ownership-checked action. DirtyGuard and Save share a loaded baseline: loading is clean, a successful save advances the baseline, and edits made during a save remain dirty. Service env is null in workspace props. Database passwords are also null in page props; Overview/Settings load credentials through a separate ownership-checked action and retain connection-string copy and password show/hide/copy controls.

The #130 audit found one client env read, in VariablesTab, and no new secret-bearing page fields. Edge inference still runs on the original services on the server and returns service IDs only. Existing inline Compose file contents were not changed by this task.

## Files touched

- `dashboard/.dockerignore`
- `dashboard/src/app/actions.ts`
- `dashboard/src/app/page.tsx`
- `dashboard/src/components/service/DatabaseCredentials.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/service/VariablesTab.tsx`
- `dashboard/src/lib/database-credentials-ui.test.ts`
- `dashboard/src/lib/database-credentials.test.ts`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/service-environment.test.ts`
- `dashboard/src/lib/service-redaction.test.ts`
- `dashboard/src/lib/service-redaction.ts`
- `dashboard/src/lib/variables-editor.test.ts`
- `dashboard/src/lib/variables-editor.ts`
- `dashboard/vitest.config.mjs`

## Checks

From `/workspace/wt-unsaved-guard-env140`:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: ESLint exit 0, TypeScript exit 0, Vitest 6 files / 88 tests passed.

```sh
sudo docker build -q -t switchyard-dash:unsaved-guard-env140-20261026-0755 dashboard
```

Passed; image `sha256:6b083cfe732995c26a6e965519cee65fc082afdda20422f4b88781dda688cb32`.

```sh
/tmp/runsy.sh sy-unsaved-guard-env140-20261026-0755 3079 unsaved-guard-env140-20261026-0755
BASE=http://127.0.0.1:3079 node /workspace/sy-codex-notes/fix/unsaved-guard-env140-proof/proof.mjs
git diff --cached --check
```

Passed. Proof contains 13 assertions; see `results.json`. The initial script attempt had an overly strict accessible-name selector; it cleaned up its fixtures. After correcting that proof selector, the complete run passed without application changes.

## Local proof and cleanup

- `01-before-variables.png`: service Overview before Variables.
- `02-loading-clean.png`: delayed environment load.
- `03-loaded-clean.png`: sentinel loaded by action, Save disabled.
- `04-dirty-tab-guard.png`: navigation warning with Keep editing / Discard.
- `05-saved-clean.png`: successful save and clean state.
- `06-discard-after-save.png`: edits compared to the new saved baseline.
- `proof.mp4`: 15.08-second recording of the full flow.
- `results.json`: HTML/RSC byte lengths and hashes, redaction assertions, all guard-flow assertions, and successful API cleanup IDs.

The live test verified sentinel absence from authenticated page HTML and RSC before the tab opened, null env for all 14 serialized services, and null database passwords. It also verified clean navigation during loading, action-only env loading, Keep editing with focus restoration, drawer-close protection, save and reopen, discard, browser beforeunload, and redaction after saving.

The throwaway project and undeployed Compose service were deleted through dashboard server actions backed by Dokploy APIs. The runner container and its data volume, both created in this session, were removed afterward. The built image remains available for review. No pre-existing apps were modified, no deployment was started, no lockfiles were changed, and no commit was made.

Limitations: live editing proof used Compose; application/database env loading and database-credential authorization/redaction are covered by Vitest across all supported kinds/engines. Database reveal/copy was preserved in code but was not separately exercised against a new live database. Inline secrets in existing Compose YAML are outside this change's env/password redaction scope.
