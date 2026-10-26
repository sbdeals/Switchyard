Resolved the #127/#140 merge in place. All changes are staged; the merge remains uncommitted for the lead.

Page services now have env=null, application buildArgs=null and databasePassword=null. Build secrets remain server-only; the client receives only buildSecretsSupported. Build arguments load on opening the Build tab through an ownership-checked action. Database credentials load only after explicit reveal. Runtime variables retain #140's on-demand load. Editor baselines initialize from loaded values and update after successful saves; a Saved flash no longer masks newer unsaved runtime edits.

Checks (all exit 0):

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — clean lint/types; 7 test files, 110 tests passed.
- `sudo docker build -q -t switchyard-dash:build-args-env140 dashboard` — passed; image sha256:5916310ac0658a75a7ad3c61252345738b9468ba3996288c155d0b2da571176c.
- `/tmp/runsy.sh sy-build-args-env140 3078 build-args-env140` — dashboard HTTP 200 on assigned port.
- `BASE=http://127.0.0.1:3078 node /workspace/sy-codex-notes/fix/build-args-env140-proof/proof.mjs sy-build-args-env140` — passed.
- `git diff --cached --check` — clean; no unresolved conflicts or unstaged changes.

The live proof checked complete HTML (80,530 bytes) and RSC (27,413 bytes) before opening tabs and again after both saves: zero runtime-env, build-argument, build-secret or database-password sentinels. It exercised lazy load, clean baselines, secret-key warnings, masked review, saving arguments while preserving an independently updated runtime env, saving runtime env while preserving buildArgs/buildSecrets/createEnvFile, reopening both editors clean, and explicit database-password reveal. Current and earlier proof fixtures were deleted using the Dokploy API. The proof dashboard remains available on :3078.

Artifacts:

- [Machine-readable assertions and cleanup](report.json)
- [Reproducible local proof script](proof.mjs)
- [MP4 key flow](build-args-env140-proof.mp4) — 8.84 seconds, 948,942 bytes.
- [Before secret tabs](01-before-secret-tabs.png)
- [Arguments loaded](02-build-lazy-loaded.png)
- [Masked review](03-masked-review.png)
- [Arguments saved](04-build-saved.png)
- [Runtime env loaded](05-runtime-lazy-loaded.png)
- [Runtime env saved](06-runtime-saved.png)
- [Reopened clean](07-reopened-clean.png)
- [Database password hidden](08-database-password-hidden.png)
- [Database password explicitly revealed](09-database-explicit-reveal.png)

Limits: Application deployment/build consumption was not exercised; both saves correctly kept deployment count at zero. Three ancillary browser responses could not be captured to completion (two before tabs and one runtime-save stream); report.json records those limitations. The separate complete HTML/RSC requests and all three explicit secret-loading action responses were captured and checked. No production deployment was accessed. No lockfiles changed or commits created.

Files touched (including the merged #140 changes):

- `dashboard/.dockerignore`
- `dashboard/src/app/actions.ts`
- `dashboard/src/app/page.tsx`
- `dashboard/src/components/service/BuildArgumentsForm.tsx`
- `dashboard/src/components/service/DatabaseCredentials.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/service/VariablesTab.tsx`
- `dashboard/src/lib/build-args-editor.test.ts`
- `dashboard/src/lib/build-args-editor.ts`
- `dashboard/src/lib/build-args-mutation.test.ts`
- `dashboard/src/lib/database-credentials.test.ts`
- `dashboard/src/lib/database-credentials.ts`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/service-environment.test.ts`
- `dashboard/src/lib/service-redaction.test.ts`
- `dashboard/src/lib/service-redaction.ts`
- `dashboard/src/lib/variables-editor.test.ts`
- `dashboard/src/lib/variables-editor.ts`
- `dashboard/vitest.config.mjs`
