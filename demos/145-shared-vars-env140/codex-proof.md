Merge resolved in place on codex/shared-vars-env140. All changes are staged; no commit was made. The lead's commit will conclude the merge.

Service env and database passwords are redacted from workspace page props. Service env, shared values, and database credentials load through ownership-checked actions. Shared-reference pickers and Defined/Missing badges receive names only. Shared editor selection is disabled during loading to prevent stale saved baselines after rapid environment changes.

Final checks (all passed):

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
# 7 test files, 128 tests passed
sudo docker build -q -t switchyard-dash:shared-vars-env140 dashboard
# sha256:9923514202723a6237748ef174c216b1d69fd89f07cfcc92999482b9e1e0b5b3
/tmp/runsy.sh sy-shared-vars-env140 3075 shared-vars-env140
# HTTP 200
BASE=http://127.0.0.1:3075 node /workspace/sy-codex-notes/fix/shared-vars-env140-proof/proof.mjs
# passed: true; all fixtures deleted through the API
git diff --cached --check
# passed; git ls-files -u returned no entries
```

Final local proof: report.json, proof.mp4 (H.264, 1440×900, 34.44 seconds), screenshots 01–07, and container-proof.txt. Only generated sentinel values appear in these artifacts. HTML/RSC response bodies are not saved; their sizes, SHA-256 hashes, fixture-presence checks, and sentinel-absence checks are in report.json.

Verified on :3075:

- Service, project, environment, and DB-password sentinels absent from initial HTML and RSC, and after shared/service saves. Save revalidation bodies also exclude them.
- Service Variables loads its env and shared key names only. Full shared-value action remains uncalled until project Settings opens.
- Shared values are masked initially; both scopes reveal, copy, edit, save, and return to a clean baseline. Unsaved drafts survive environment switching; loading prevents switching back to stale data.
- Both reference picker scopes work; Defined/Missing badges update; service values persist and reopen with a clean baseline.
- Database Overview connection copy and Settings password reveal/copy work through lazy credential actions. The postgres fixture was never deployed.
- A session-created Alpine Compose container resolved both edited shared values through Dokploy. Exact-container printenv output is in container-proof.txt.
- The project's Compose service, postgres record, and environments were deleted via Dokploy APIs. Project absence and container absence were verified. Previous attempt fixtures were also removed; the final script verified the immediately preceding project was absent.

Limitations: local Dokploy v0.30.10 only. Browser proof exercised Compose and postgres; unit tests cover service env loading and redaction across all service kinds/database engines. No production endpoints or paid APIs were used. The throwaway dashboard sy-shared-vars-env140 remains on :3075 for review; its fixture resources are gone.

Earlier attempt folders document proof-harness/setup issues (response-body capture, login throttling, default-environment rename). The fourth attempt reached the shared panel but assumed its default selection; cleanup completed before a route teardown exception prevented report serialization. The final script explicitly selects the intended environment and drains routes before shutdown.

Exact repository files touched (relative to worktree root; R indicates the config rename):

```text
M	dashboard/.dockerignore
M	dashboard/src/app/actions.ts
A	dashboard/src/app/database-credentials-actions.ts
M	dashboard/src/app/page.tsx
M	dashboard/src/app/shared-variable-actions.ts
M	dashboard/src/components/SharedVariablesPanel.tsx
M	dashboard/src/components/service/ServiceDrawer.tsx
M	dashboard/src/components/service/VariablesTab.tsx
M	dashboard/src/components/use-shared-variables.ts
A	dashboard/src/lib/database-credentials.test.ts
M	dashboard/src/lib/dokploy.ts
A	dashboard/src/lib/service-environment.test.ts
A	dashboard/src/lib/service-redaction.test.ts
A	dashboard/src/lib/service-redaction.ts
M	dashboard/src/lib/shared-variable-actions.test.ts
M	dashboard/src/lib/shared-variables-ui.test.ts
M	dashboard/src/lib/shared-variables.test.ts
M	dashboard/src/lib/shared-variables.ts
A	dashboard/src/lib/variables-editor.test.ts
A	dashboard/src/lib/variables-editor.ts
R063	dashboard/vitest.config.ts	dashboard/vitest.config.mjs
```
