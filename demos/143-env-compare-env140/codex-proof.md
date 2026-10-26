# env-compare-env140 proof

Implemented in `/workspace/wt-env-compare-env140`, stacked on `codex/env-compare` with the pending `origin/codex/env-redaction` merge. The `.dockerignore` conflict is resolved and staged; the merge remains uncommitted for the lead.

Every workspace service has `env: null`; database passwords are null both in the workspace loader and page projection. Variables load through the ownership-checked action. Database password and connection-string reveal/copy now use an ownership-checked action on each click. The existing compare action already returns only metadata, keys, and diff statuses, and rechecks access when revealing values. Added regressions retain that boundary across all five database engines and after service removal. Editor tests cover clean load/save baselines and edits during a pending save.

## Files touched

- `dashboard/.dockerignore`
- `dashboard/vitest.config.mjs`
- `dashboard/src/app/actions.ts`
- `dashboard/src/app/page.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/service/VariablesTab.tsx`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/service-redaction.ts`
- `dashboard/src/lib/variables-editor.ts`
- `dashboard/src/lib/database-password.test.ts`
- `dashboard/src/lib/environment-compare-data.test.ts`
- `dashboard/src/lib/page-redaction.test.ts`
- `dashboard/src/lib/service-environment.test.ts`
- `dashboard/src/lib/service-redaction.test.ts`
- `dashboard/src/lib/variables-editor.test.ts`

## Exact checks and results

From the worktree root:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: lint, TypeScript, 8 test files / 125 tests.

```sh
sudo docker build -q -t switchyard-dash:env-compare-env140-0737 dashboard
```

Passed. Image: `sha256:8919bd55a9b546105a0965a939fca1e71870689690a74ebd94332da1c4bff09e`.

```sh
/tmp/runsy.sh sy-env-compare-env140-0737 3076 env-compare-env140-0737
BASE=http://127.0.0.1:3076 node /workspace/sy-codex-notes/fix/env-compare-env140-proof/proof.mjs
```

Passed: HTTP 200 and 15 browser assertions. `proof-results.json` records response sizes, hashes, and redacted env field counts. HTML/RSC bodies were checked in memory without saving unrelated workspace data. Both responses excluded the unique env sentinel and DB password before opening tabs and after saving/revealing. Real server actions were exercised; the proof captures action responses through Playwright routing without mocking their contents. External browser requests were blocked.

The browser verified all four variable diff statuses, masked values, reveal/hide, clean editor load, dirty edit, save persistence, clean saved baseline, revert-to-saved, reload after reopening, database password/connection-string reveal and copy, and a fresh comparison containing the saved key.

```sh
BASE=http://127.0.0.1:3076 node /workspace/sy-codex-notes/fix/env-compare-env140-proof/fixture.mjs cleanup
sudo docker rm -f sy-env-compare-env140-0737
git diff --check
git ls-files -u
```

Passed: the throwaway project was deleted through `project.remove` and its absence confirmed through `project.all`, with all three child service IDs also confirmed absent (`cleanup.json`). The dashboard container created for this proof was removed. Diff check passed; no unmerged paths remain. No commit, lockfile change, or production operation occurred.

## Artifacts and limits

- `01-page-before-tabs.png`: initial workspace.
- `02-compare-masked.png`: comparison with masked values.
- `03-compare-revealed.png`: unique env sentinel revealed, plus added/removed/unchanged keys.
- `04-variables-saved-clean.png`: saved key and disabled Save button.
- `05-database-reveal.png`: explicitly revealed connection string.
- `06-compare-after-save.png`: refreshed masked comparison.
- `env-compare-env140.mp4`: complete successful browser flow, H.264, 12.32 seconds.
- `proof-results.json`, `cleanup.json`: machine-readable evidence.
- `fixture.mjs`, `proof.mjs`, `fixture.json`: test setup, assertions, and generated fixture identifiers/sentinels.

Live proof covered application variables and PostgreSQL credentials/configuration, without deploying app workloads. Other database engines and authorization denial paths were covered by Vitest. Dokploy creates an empty `production` environment automatically; explicitly created projects, environments, apps, and databases used the `env-compare-env140-0737` prefix. The entire throwaway project was deleted.
