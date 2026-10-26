# Environment comparison proof — review round 1

Local-only proof on 127.0.0.1:3037, 2026-10-26. Worktree: /workspace/wt-env-compare. No commits, lockfile changes, paid APIs, or production deployments. Earlier proof artifacts are archived under round-0/ and are superseded by this round.

## Scope correction

page.tsx, VariablesTab.tsx, and ComposeTabs.tsx are restored byte-for-byte to main. workspace-privacy.ts and its test are removed, along with prepareWorkspaceServices, revealServiceConfigurationAction, loadServiceConfiguration, and their dedicated tests. Compose summary remains only for comparison image/build/replica metadata; its unused skeleton output was removed.

Comparison is self-contained: it loads its own data server-side via the current user's project.all tree, returns only metadata and variable keys/statuses, and reveals one selected variable after fresh authorization. The original workspace payload and immediate editing behavior are unchanged from main.

**Separate follow-up:** workspace-wide env/composeFile payload hardening needs a coordinated decision with variables autocomplete, staged changes, shared-variable badges, domain suggestions, and other client consumers. The existing workspace still carries raw service.env and composeFile as on main. The masking guarantees and network assertions here apply specifically to comparison action responses, not the existing workspace payload.

## Refreshed artifacts

- 01-masked.png: production vs env-compare-staging, changed image and masked variable rows.
- 02-revealed.png: explicitly revealed COMPARE_TOKEN row.
- 03-presence.png: services present on only one side after swapping A/B.
- 04-variables-main.png: immediately populated Variables editor with no reveal gate.
- 05-compose-main.png: immediately populated Compose editor with no reveal gate.
- env-compare.mp4: refreshed 12.84-second comparison recording.
- proof-results.json: six comparison UI/network assertions, including forged environment denial.
- editor-results.json: immediate editing, save/reopen persistence, and full YAML checks.
- main-parity.json: all three restored files exactly match main.
- deployment-status.jsonl: four successfully deployed fixture services.
- cleanup-results.json: fixture project and all session fixture/dashboard containers removed.

The newly created env-compare-* project held production and env-compare-staging, each with two small compose services. env-compare-api matched across environments with alpine:3.20 vs busybox:1.37 and changed, added, removed, empty, and unchanged variables. env-compare-worker existed only in production; env-compare-jobs existed only in staging. No host ports or domains were created. The editor test changed and then restored only the fixture worker's variables. Fixtures were removed via the Dokploy API; the dashboard container/image/volume created this round were removed through Docker.

## Exact checks and results

From /workspace/wt-env-compare:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

PASS: lint and TypeScript clean; 3 Vitest files, 51 tests passed (11 diff/parser, 35 data/actions, 5 compose metadata).

```sh
git diff main --exit-code -- dashboard/src/app/page.tsx dashboard/src/components/service/VariablesTab.tsx dashboard/src/components/service/ComposeTabs.tsx
git diff --check
```

PASS: no differences in restored files; diff whitespace clean.

```sh
sudo docker build -q -t switchyard-dash:env-compare dashboard && /tmp/runsy.sh sy-env-compare 3037 env-compare
```

PASS: dashboard image built; /login returned HTTP 200 on assigned port. Proof image: sha256:68a441a904132bd710e97eb186afb64fd189660668bb3ac5be5542fc7484965a.

```sh
BASE=http://127.0.0.1:3037 node /workspace/sy-codex-notes/fix/env-compare-proof/proof.mjs
BASE=http://127.0.0.1:3037 node /workspace/sy-codex-notes/fix/env-compare-proof/editors.mjs
node /workspace/sy-codex-notes/fix/env-compare-proof/fixtures.mjs cleanup
node /workspace/sy-codex-notes/fix/env-compare-proof/verify-cleanup.mjs
```

PASS: comparison response contains keys/statuses but no variable values or raw YAML; reveal returns only the requested A/B values; forged environment ID is denied; hide/swap/close clear comparison state; no comparison mutation controls exist. Variables is immediately editable, saves successfully, and retains the saved value when reopened; fixture values were restored. Compose immediately shows the full original YAML. Cleanup is verified separately after deletion.

Harness adjustments: the first recording encountered browser response-body eviction; capturing fixture action responses before passing them through fixed recording. The editor check initially observed the pending save state too early, then waited unnecessarily for stream completion; waiting for the existing Saved indicator and stopped spinner verified the actual UI flow. No product changes were made for these harness issues.

## Remaining limitations

Comparison uses saved configuration and exact service names. Variable differences use the Dokploy Variables block; runtime values, interpolation, and inline YAML environment differences are not evaluated. Duplicate service names and malformed quoted env/YAML produce a safe comparison error. Compose metadata uses js-yaml already present in the existing lockfile via ESLint. Non-compose provider metadata and authorization edge cases have unit coverage; live proof uses compose services. Sync/apply remains a possible follow-up.
